import { env } from "@/app/utils/env";

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (!env.langfuse.publicKey) return;

    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    const { setLangfuseTracerProvider } = await import("@langfuse/tracing");

    setLangfuseTracerProvider(
        new NodeTracerProvider({
            spanProcessors: [new LangfuseSpanProcessor({
                publicKey: env.langfuse.publicKey,
                secretKey: env.langfuse.secretKey,
                baseUrl: env.langfuse.baseUrl,
            })],
        })
    );
}
