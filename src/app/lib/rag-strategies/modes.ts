// Client-safe: no LangChain/LLM imports here, so this can be imported from UI components.
export type RagMode = "naive" | "condense";

export const DEFAULT_RAG_MODE: RagMode = "condense";

export const RAG_MODES: { value: RagMode; label: string }[] = [
    { value: "condense", label: "Query Condensing" },
    { value: "naive", label: "Naive RAG" },
];
