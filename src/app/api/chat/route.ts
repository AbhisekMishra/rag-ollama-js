import { CallbackHandler } from "langfuse-langchain";
import { outputChain } from "@/app/lib/runnables";
import { env } from "@/app/utils/env";

export async function POST(req: Request) {
    const userId = req.headers.get('User-Id');
    const sessionId = req.headers.get('Session-Id');
    const { question, history } = await req.json();

    // Build callbacks array — empty when LangFuse keys are not configured
    const callbacks = env.langfuse.publicKey ? [
        new CallbackHandler({
            publicKey: env.langfuse.publicKey,
            secretKey: env.langfuse.secretKey,
            baseUrl: env.langfuse.baseUrl,
            userId: userId ?? undefined,
            sessionId: sessionId ?? undefined,
            metadata: { historyLength: history?.length ?? 0 },
            tags: ["rag-chat"],
        })
    ] : [];

    try {
        const stream = await outputChain({ userId }).stream(
            { question, history },
            { callbacks }
        );
        return new Response(stream);
    } catch (error) {
        console.error("Chat error:", error);
        return new Response("Failed to generate response", { status: 500 });
    }
}
