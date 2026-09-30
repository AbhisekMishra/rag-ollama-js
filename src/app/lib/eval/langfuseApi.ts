import { env } from "../../utils/env";

// Thin authenticated wrapper over LangFuse's public REST API — same rationale as
// runEval.ts's pushScoreToLangfuse: the installed SDKs (@langfuse/core/langchain/otel/tracing)
// have no ergonomic write helpers for datasets/prompts. Returns null (no-op) when LangFuse isn't
// configured, matching every other optional-LangFuse code path in this app.
export async function langfuseFetch(path: string, body: unknown): Promise<unknown | null> {
    if (!env.langfuse.publicKey) return null;

    const auth = Buffer.from(`${env.langfuse.publicKey}:${env.langfuse.secretKey}`).toString("base64");
    const response = await fetch(`${env.langfuse.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`LangFuse ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
}
