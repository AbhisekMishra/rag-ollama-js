import { createOllamaJudge } from "raglens";

import { RAG_MODES } from "../src/app/lib/rag-strategies/modes";
import { runEvalForMode } from "../src/app/lib/eval/runEval";
import { EVAL_DOCUMENT } from "../src/app/lib/eval/goldenSet";
import { env } from "../src/app/utils/env";

function parseUserId(): string {
    const arg = process.argv.find((a) => a.startsWith("--userId="));
    return arg ? arg.slice("--userId=".length) : "eval-user";
}

// src/instrumentation.ts does this same setup, but only for the Next.js request lifecycle
// (its register() hook is gated on process.env.NEXT_RUNTIME, which is never set for a plain
// script run via tsx) — without registering a tracer provider here too, CallbackHandler would
// still generate a trace id locally, but the actual trace/span data would never be exported to
// LangFuse, leaving pushScoreToLangfuse's scores attached to a trace id nothing backs. Returns
// the provider (or null if LangFuse isn't configured) so main() can flush it before exiting —
// a short-lived script, unlike the long-running dev/prod server, can otherwise exit before the
// span processor's batched export ever runs.
async function registerLangfuseTracing(): Promise<{ shutdown: () => Promise<void> } | null> {
    if (!env.langfuse.publicKey) return null;

    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    const { setLangfuseTracerProvider } = await import("@langfuse/tracing");

    const provider = new NodeTracerProvider({
        spanProcessors: [new LangfuseSpanProcessor({
            publicKey: env.langfuse.publicKey,
            secretKey: env.langfuse.secretKey,
            baseUrl: env.langfuse.baseUrl,
        })],
    });
    setLangfuseTracerProvider(provider);
    return provider;
}

async function main() {
    const tracerProvider = await registerLangfuseTracing();

    const userId = parseUserId();
    const runTag = `eval-run:${new Date().toISOString()}`;

    console.log(`Running Phase 2 eval against userId="${userId}" — assumes "${EVAL_DOCUMENT}" is the uploaded document for that user.`);
    console.log(`Judge model: ${env.ollama.llm.model} (same model the chains answer with — self-judging bias, documented in CLAUDE.md).`);
    if (!env.langfuse.publicKey) {
        console.log("LANGFUSE_PUBLIC_KEY not set — scores will be computed but not pushed anywhere.");
    }

    // Same judge model that generates the answers judges them here — a real limitation (see
    // CLAUDE.md's Evaluation section), not solved in this pass.
    const judge = createOllamaJudge(env.ollama.llm);

    const rows: { mode: string; faithfulness: string; answerRelevancy: string }[] = [];

    try {
        for (const { value: mode } of RAG_MODES) {
            console.log(`\n=== ${mode} ===`);
            const summary = await runEvalForMode(mode, { userId }, judge, runTag);
            rows.push({
                mode,
                faithfulness: summary.averages.faithfulness.toFixed(2),
                answerRelevancy: summary.averages.answer_relevancy.toFixed(2),
            });
        }
    } finally {
        // Flush any spans the batched processor hasn't exported yet — a short-lived script can
        // otherwise exit before that happens, silently dropping traces (see registerLangfuseTracing).
        await tracerProvider?.shutdown();
    }

    console.log("\nComparison across all modes:");
    console.table(rows);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
