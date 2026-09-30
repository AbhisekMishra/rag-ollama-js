import { randomUUID } from "node:crypto";

import { CallbackHandler } from "@langfuse/langchain";
import { evaluate, faithfulness, answerRelevancy, contextPrecision, contextRecall, type Judge, type Sample, type EvaluationSummary } from "raglens";

import { buildRagChain, type RagMode } from "../rag-strategies";
import { env } from "../../utils/env";
import { GOLDEN_SET } from "./goldenSet";
import { goldenItemId } from "./dataset";
import { langfuseFetch } from "./langfuseApi";

interface ChainEvalResult {
    answer: string;
    context: string;
    traceId: string | null;
}

// Drives the chain via streamEvents() rather than .invoke() — the SAME event-matching approach
// api/chat/route.ts uses — because each mode's final chain output shape isn't uniform (self-rag
// appends a critiqueGroundedness step returning {answer, groundedness}; agentic/adaptive's output
// depends on which RunnableBranch arm fired). Reading the named "answerLLM" token stream and the
// named "retrieveAndBuildContext" step's output sidesteps that entirely, regardless of mode.
async function attemptChainForEval(mode: RagMode, filter: Record<string, unknown>, question: string, tags: string[]): Promise<ChainEvalResult> {
    const handler = new CallbackHandler({
        userId: typeof filter.userId === "string" ? filter.userId : undefined,
        tags: ["rag-eval", `rag-mode:${mode}`, ...tags],
    });
    const callbacks = env.langfuse.publicKey ? [handler] : [];

    const chain = buildRagChain(mode, filter);
    let answer = "";
    let context = "";

    for await (const event of chain.streamEvents({ question, history: [] }, { version: "v2", callbacks })) {
        if (event.event === "on_chain_end" && event.name === "retrieveAndBuildContext") {
            context = (event.data.output as { context?: string } | undefined)?.context ?? "";
        } else if (event.event === "on_chat_model_stream" && event.name === "answerLLM") {
            const text = event.data.chunk?.content;
            if (typeof text === "string") answer += text;
        }
    }

    return { answer, context, traceId: handler.last_trace_id };
}

const MAX_CHAIN_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local Ollama streaming occasionally drops a response mid-stream ("Did not receive done or
// success response in stream", from the `ollama` npm client) under the sustained sequential
// call volume a full eval run makes — observed reproducibly (same mode, same error) across
// multiple full-run attempts, with Ollama itself healthy immediately after each failure. Root
// cause wasn't pinned down (client-library/transport issue, not this app's chain logic) —
// retrying the same call after a short pause reliably works around it, so a transient failure
// doesn't abort an otherwise-long run.
async function runChainForEval(mode: RagMode, filter: Record<string, unknown>, question: string, tags: string[]): Promise<ChainEvalResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_CHAIN_RETRIES; attempt++) {
        try {
            return await attemptChainForEval(mode, filter, question, tags);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[${mode}] chain execution failed (attempt ${attempt + 1}/${MAX_CHAIN_RETRIES + 1}): ${message}`);
            if (attempt < MAX_CHAIN_RETRIES) await sleep(RETRY_DELAY_MS);
        }
    }
    throw lastError;
}

// LangFuse's currently-installed SDKs (@langfuse/core/langchain/otel/tracing, all 5.11.0) have no
// ergonomic score-create helper — their `Scores` class is read-only, and constructing the
// Fern-generated `LangfuseAPIClient` for one write call isn't worth the ambiguity. This is the
// same stable, documented ingestion REST shape those SDKs wrap internally (a `score-create` batch
// event), called directly instead. No-ops when LangFuse isn't configured, matching every other
// optional-LangFuse code path in this app.
async function pushScoreToLangfuse(traceId: string | null, name: string, value: number, comment?: string): Promise<void> {
    if (!env.langfuse.publicKey || !traceId) return;

    const auth = Buffer.from(`${env.langfuse.publicKey}:${env.langfuse.secretKey}`).toString("base64");
    const response = await fetch(`${env.langfuse.baseUrl}/api/public/ingestion`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
            batch: [{
                type: "score-create",
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                body: { id: randomUUID(), traceId, name, value, comment },
            }],
        }),
    });
    if (!response.ok) {
        console.error(`Failed to push score "${name}" to LangFuse: ${response.status} ${await response.text()}`);
    }
}

// context_precision needs one entry per retrieved chunk in rank order. The chain's context is a
// single string of "[Source N | Page P]"-headed chunks (buildContext/buildMultiHopContext), so
// split on those headers. faithfulness/context_recall join the contexts anyway, so the split is
// equivalent for them. Modes with no retrieval (a DIRECT route) yield an empty context -> [].
function splitContext(context: string): string[] {
    return context
        .split(/(?=\[Source \d+ \| Page \d+\])/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
}

// Runs the full golden set through one RAG mode, scores each sample with raglens, and pushes
// both metrics back to LangFuse against that question's own trace (so a mode's scores can be
// inspected per-trace in the LangFuse UI, not just as an aggregate).
export async function runEvalForMode(mode: RagMode, filter: Record<string, unknown>, judge: Judge, runTag: string): Promise<EvaluationSummary> {
    const samples: Sample[] = [];
    const traceIds: (string | null)[] = [];

    for (const golden of GOLDEN_SET) {
        const { answer, context, traceId } = await runChainForEval(mode, filter, golden.question, [runTag]);
        samples.push({ question: golden.question, answer, contexts: splitContext(context), groundTruth: golden.groundTruth });
        traceIds.push(traceId);
    }

    const summary = await evaluate(samples, { metrics: [faithfulness, answerRelevancy, contextPrecision, contextRecall], judge });

    await Promise.all(summary.results.flatMap((result, i) =>
        Object.entries(result.scores).map(([metricName, { score, reason }]) =>
            pushScoreToLangfuse(traceIds[i], metricName, score, reason)
        )
    ));

    // Link each trace to its dataset item as one dataset run per mode+eval-run, so LangFuse's
    // dataset "Runs" view compares modes side by side. Requires `npm run langfuse:sync` to have
    // created the dataset first; a failure here shouldn't discard the computed scores.
    await Promise.all(traceIds.map(async (traceId, i) => {
        if (!traceId) return;
        try {
            await langfuseFetch("/api/public/dataset-run-items", {
                runName: `${mode} | ${runTag}`,
                datasetItemId: goldenItemId(i),
                traceId,
            });
        } catch (error) {
            console.error(`[${mode}] could not link trace to dataset item (run langfuse:sync first?):`, error instanceof Error ? error.message : error);
        }
    }));

    return summary;
}
