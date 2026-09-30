// Client-safe: no LangChain/Supabase imports, so this can be imported from client
// components (see rag-strategies/modes.ts for the same pattern).
export const CHUNK_INDEXES = ["documents", "sentence_documents", "child_documents", "raptor_documents"] as const;
export type ChunkIndex = typeof CHUNK_INDEXES[number];
