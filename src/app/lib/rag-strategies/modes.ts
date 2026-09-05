// Client-safe: no LangChain/LLM imports here, so this can be imported from UI components.
export type RagMode = "naive" | "condense" | "multi-query" | "hyde" | "hybrid" | "rerank" | "contextual-compression" | "sentence-window" | "parent-document" | "auto-merging";

// Which stage of the pipeline each mode modifies, so the UI can group modes by
// what they actually change rather than listing them as one flat, undifferentiated list.
export type RagStage = "query-transformation" | "retrieval" | "post-retrieval" | "iterative" | "agentic" | "structural";

export const DEFAULT_RAG_MODE: RagMode = "condense";

export const RAG_STAGE_LABELS: Record<RagStage, string> = {
    "query-transformation": "Query Transformation",
    retrieval: "Retrieval Strategy",
    "post-retrieval": "Post-Retrieval",
    iterative: "Iterative / Self-Correcting",
    agentic: "Agentic / Routing",
    structural: "Structural",
};

export const RAG_MODES: { value: RagMode; label: string; stage: RagStage }[] = [
    { value: "naive", label: "Naive RAG", stage: "retrieval" },
    { value: "hybrid", label: "Hybrid Search", stage: "retrieval" },
    { value: "sentence-window", label: "Sentence-Window Retrieval", stage: "retrieval" },
    { value: "parent-document", label: "Parent-Document Retrieval", stage: "retrieval" },
    { value: "auto-merging", label: "Auto-Merging Retrieval", stage: "retrieval" },
    { value: "condense", label: "Query Condensing", stage: "query-transformation" },
    { value: "multi-query", label: "Multi-Query", stage: "query-transformation" },
    { value: "hyde", label: "HyDE", stage: "query-transformation" },
    { value: "rerank", label: "Re-ranking", stage: "post-retrieval" },
    { value: "contextual-compression", label: "Contextual Compression", stage: "post-retrieval" },
];
