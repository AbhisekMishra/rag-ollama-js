export const env = {
    supabase: {
        apiKey: process.env.SUPABASE_API_KEY || '',
        url: process.env.SUPABASE_URL || '',
    },
    ollama: {
        llm: {
            baseUrl: process.env.OLLAMA_LLM_BASE_URL || '',
            model: process.env.OLLAMA_LLM_MODEL || '',
        },
        embeddings: {
            baseUrl: process.env.OLLAMA_EMBEDDINGS_BASE_URL || '',
            model: process.env.OLLAMA_EMBEDDINGS_MODEL || '',
        }
    },
    // Optional — tracing is skipped if keys are absent
    langfuse: {
        publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
        secretKey: process.env.LANGFUSE_SECRET_KEY || '',
        baseUrl: process.env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com',
    }
}