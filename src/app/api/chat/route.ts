import { CallbackHandler } from "@langfuse/langchain";
import { buildRagChain, DEFAULT_RAG_MODE, RAG_STRATEGIES, type RagMode } from "@/app/lib/rag-strategies";
import { env } from "@/app/utils/env";

function resolveRagMode(candidate: unknown): RagMode {
    return typeof candidate === "string" && candidate in RAG_STRATEGIES
        ? candidate as RagMode
        : DEFAULT_RAG_MODE;
}

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
