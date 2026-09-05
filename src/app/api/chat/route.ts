import { CallbackHandler } from "@langfuse/langchain";
import { buildRagChain, DEFAULT_RAG_MODE, RAG_STRATEGIES, type RagMode } from "@/app/lib/rag-strategies";
import { RAG_PIPELINE_STAGES } from "@/app/lib/rag-strategies/pipeline-metadata";
import { env } from "@/app/utils/env";

function resolveRagMode(candidate: unknown): RagMode {
    return typeof candidate === "string" && candidate in RAG_STRATEGIES
        ? candidate as RagMode
        : DEFAULT_RAG_MODE;
}

// Every pipeline-stage id across every mode, so the generic stage-progress branch below can
// recognize a streamEvents() event as belonging to a stage regardless of whether it fired as
// on_chain_*, on_retriever_*, or on_chat_model_* (the event-type prefix depends on the kind of
// runnable that was named, not on anything the UI cares about).
const STAGE_IDS = new Set(Object.values(RAG_PIPELINE_STAGES).flat().map((stage) => stage.id));

interface DocLike {
    pageContent: string;
    metadata?: { pageNumber?: number };
}

function summarizeDocs(docs: DocLike[]): { count: number; chunks: { snippet: string; pageNumber: number }[] } {
    return {
        count: docs.length,
        chunks: docs.map((doc) => ({
            snippet: doc.pageContent.slice(0, 160),
            pageNumber: doc.metadata?.pageNumber ?? 0,
        })),
    };
}

// Shapes each named stage's raw streamEvents() output into a small display-ready payload for
// the pipeline visualizer. Stages with nothing extra to show beyond progress (e.g. answerLLM,
// whose tokens already stream separately) fall through to undefined.
function shapeStageData(name: string, output: unknown): unknown {
    switch (name) {
        case "vectorRetrieve":
        case "dedupeCandidates":
        case "hybridSearch":
        case "graphSearch":
        case "expandWindow":
        case "expandToParent":
        case "autoMergeChunks":
            return summarizeDocs(output as DocLike[]);
        case "vectorRetrieveMany":
            // The batch fan-out step's output is one Document[] per query phrasing — flatten
            // before summarizing (deduping happens in the next named step).
            return summarizeDocs((output as DocLike[][]).flat());
        case "overFetchCandidates":
            return { count: (output as { candidates: DocLike[] }).candidates.length };
        case "scoreCandidates":
        case "compressChunks":
        case "standaloneQuestion":
        case "generatePhrasings":
        case "hydeDraft":
        case "critiqueGroundedness":
        case "routeQuery":
        case "decomposeQuestions":
        case "buildHopContext":
        case "routeComplexity":
            return output;
        case "judgeSufficiency":
        case "cragGrade":
            // Both named steps' output is {docs|kept, attempts} (see selfRagRetrieve/cragRetrieve
            // in retrieval.ts) — show the per-attempt query/score table, not the raw retrieved
            // docs (those are only meaningful per-attempt, and the final attempt's docs already
            // surface via `sources`).
            return (output as { attempts: unknown }).attempts;
        default:
            return undefined;
    }
}

// Shapes each named stage's raw input (what actually flows INTO it — the literal text sent to
// a vector search, or the {question, history} wrapper object for an LLM sub-chain) into
// something small and display-ready, mirroring shapeStageData for outputs.
function shapeStageInput(input: unknown): unknown {
    if (typeof input === "string") return input;
    // Only show array inputs that are plain query-text lists (e.g. multi-query's phrasings) —
    // dedupeCandidates' input is raw Document[][] internals, not meant for display.
    if (Array.isArray(input) && input.every((item) => typeof item === "string")) return input;
    if (input && typeof input === "object") {
        // Retrievers trace their input as { query }; every other named stage here is invoked
        // with either a bare { question, history } wrapper or { question, candidates }.
        if ("query" in input) return (input as { query: unknown }).query;
        if ("question" in input) return (input as { question: unknown }).question;
    }
    return undefined;
}

interface ChatMessageLike {
    content?: unknown;
    _getType?: () => string;
}

function messageText(message: ChatMessageLike): string {
    const role = typeof message._getType === "function" ? message._getType() : "message";
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return `${role}: ${content}`;
}

// Reconstructs the literal prompt sent to Ollama's chat endpoint from a chat-model event's
// raw `input` (LangChain's on_chat_model_* events carry `{messages: BaseMessage[][]}`) — the
// actual rendered text, not the {question, history} object that was fed into the surrounding chain.
function extractPromptText(input: unknown): string {
    const messages = (input as { messages?: ChatMessageLike[][] } | undefined)?.messages;
    if (!Array.isArray(messages)) return "";
    return messages.flat().map(messageText).join("\n\n");
}

function extractCompletionText(output: unknown): string {
    const message = output as ChatMessageLike | undefined;
    if (!message) return "";
    return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

// The three query-transformation stages wrap their LLM call in a distinctly-named inner
// runnable (see condense.ts/multi-query.ts/hyde.ts) so its on_chat_model_end can be captured
// here without colliding with the outer sequence's own stage-progress events of the same name.
const LLM_STAGE_RUNNAMES: Record<string, string> = {
    standaloneQuestionLLM: "standaloneQuestion",
    generatePhrasingsLLM: "generatePhrasings",
    hydeDraftLLM: "hydeDraft",
    routeQueryLLM: "routeQuery",
    decomposeQuestionsLLM: "decomposeQuestions",
    routeComplexityLLM: "routeComplexity",
};

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request) {
    try {
        const userId = req.headers.get('User-Id');
        const sessionId = req.headers.get('Session-Id');
        const { question, history, ragMode } = await req.json();
        const mode = resolveRagMode(ragMode);

        const callbacks = env.langfuse.publicKey ? [
            new CallbackHandler({
                userId: userId ?? undefined,
                sessionId: sessionId ?? undefined,
                traceMetadata: { historyLength: history?.length ?? 0 },
                tags: ["rag-chat", `rag-mode:${mode}`],
            })
        ] : [];

        const chain = buildRagChain(mode, { userId });

        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                // Scoped per-request: buffers, for the three query-transformation stages, the
                // literal LLM prompt/completion captured off their distinctly-named inner LLM call
                // (the stage's own _end event arrives after this, so it's ready to merge in by then).
                const stageLlmIO = new Map<string, { prompt: string; completion: string }>();

                try {
                    // `retrieveAndBuildContext` and `answerLLM` are named steps inside the chain
                    // (see rag-strategies/*) — streamEvents lets the route read the retrieved
                    // `sources` out of the execution graph as soon as that step finishes, ahead
                    // of the answer tokens that follow it later in the same chain.
                    for await (const event of chain.streamEvents({ question, history }, { version: "v2", callbacks })) {
                        if (event.event === "on_chain_end" && event.name === "retrieveAndBuildContext") {
                            controller.enqueue(sseEvent("sources", event.data.output?.sources ?? []));
                        } else if (event.event === "on_chat_model_stream" && event.name === "answerLLM") {
                            const text = event.data.chunk?.content;
                            if (typeof text === "string" && text.length > 0) {
                                controller.enqueue(sseEvent("token", { text }));
                            }
                        }

                        // Pipeline-visualizer progress: independent of the sources/token emission
                        // above (both can fire off the same underlying event, e.g. retrieveAndBuildContext's
                        // on_chain_end also produces a "stage" end for whichever named sub-step it wraps).
                        if (event.event.endsWith("_start") && STAGE_IDS.has(event.name)) {
                            controller.enqueue(sseEvent("stage", { stageId: event.name, status: "start" }));
                        } else if (event.event.endsWith("_end") && STAGE_IDS.has(event.name)) {
                            // answerLLM IS the chat-model event itself (no wrapping sequence to name),
                            // so its prompt/completion is captured directly here rather than via
                            // LLM_STAGE_RUNNAMES below.
                            const llm = event.event === "on_chat_model_end"
                                ? { prompt: extractPromptText(event.data.input), completion: extractCompletionText(event.data.output) }
                                : stageLlmIO.get(event.name);
                            stageLlmIO.delete(event.name);
                            controller.enqueue(sseEvent("stage", {
                                stageId: event.name,
                                status: "end",
                                data: {
                                    input: shapeStageInput(event.data.input),
                                    output: shapeStageData(event.name, event.data.output),
                                    llm,
                                },
                            }));
                        } else if (event.event === "on_chat_model_end" && event.name in LLM_STAGE_RUNNAMES) {
                            stageLlmIO.set(LLM_STAGE_RUNNAMES[event.name], {
                                prompt: extractPromptText(event.data.input),
                                completion: extractCompletionText(event.data.output),
                            });
                        }
                    }
                    controller.enqueue(sseEvent("done", {}));
                } catch (error) {
                    console.error("Streaming error:", error);
                    controller.enqueue(sseEvent("error", { message: "Failed to generate response" }));
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(body, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        });
    } catch (error) {
        console.error("Chat error:", error);
        return new Response("Failed to generate response", { status: 500 });
    }
}
