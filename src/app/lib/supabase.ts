import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { createClient } from "@supabase/supabase-js";

import { embeddings } from "./ollama";
import { env } from "../utils/env";
import { CHUNK_INDEXES, type ChunkIndex } from "./chunk-index";

export { CHUNK_INDEXES, type ChunkIndex };

const { supabase: { url, apiKey } } = env;

export const supabaseClient = createClient(
    url,
    apiKey,
);

export const vectorStore = (filter?: Record<string, unknown>) => new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: "documents",
    queryName: "match_documents",
    filter: filter || {}
});

export const retriever = (filter: Record<string, unknown>, k?: number) => vectorStore(filter).asRetriever(k);

export const sentenceVectorStore = (filter?: Record<string, unknown>) => new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: "sentence_documents",
    queryName: "match_sentence_documents",
    filter: filter || {}
});

export const sentenceRetriever = (filter: Record<string, unknown>, k?: number) => sentenceVectorStore(filter).asRetriever(k);

export const childVectorStore = (filter?: Record<string, unknown>) => new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: "child_documents",
    queryName: "match_child_documents",
    filter: filter || {}
});

export const childRetriever = (filter: Record<string, unknown>, k?: number) => childVectorStore(filter).asRetriever(k);

// Summary nodes of the RAPTOR tree (levels >= 1; the leaves are just the `documents` rows) —
// see lib/raptor.ts and supabaseScripts.txt STEP 13.
export const raptorVectorStore = (filter?: Record<string, unknown>) => new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: "raptor_documents",
    queryName: "match_raptor_documents",
    filter: filter || {}
});

export const raptorRetriever = (filter: Record<string, unknown>, k?: number) => raptorVectorStore(filter).asRetriever(k);

interface HybridSearchRow {
    id: number;
    content: string;
    metadata: { pageNumber?: number };
}

// Hybrid retrieval: the hybrid_search RPC (supabaseScripts.txt STEP 9) runs full-text and
// vector search side by side and fuses the two rankings with reciprocal rank fusion. The
// raw query text goes to keyword search while its embedding goes to vector search — this
// is why it can't go through SupabaseVectorStore, which only ever sends the embedding.
export const hybridSearcher = (filter: Record<string, unknown>) => async (query: string) => {
    const queryEmbedding = await embeddings.embedQuery(query);
    const { data, error } = await supabaseClient.rpc("hybrid_search", {
        query_text: query,
        query_embedding: queryEmbedding,
        match_count: 4,
        filter: filter || {},
    });
    if (error) throw new Error(`hybrid_search RPC failed: ${error.message}`);
    return (data as HybridSearchRow[]).map((row) => ({
        pageContent: row.content,
        metadata: row.metadata,
    }));
};

// Plain "list every stored chunk for this user" query, for the Chunks viewer UI. Unlike
// vectorStore()/retriever() above, this has no query_embedding and doesn't go through a
// match_* RPC — it's a direct table select ("browse what was stored"), not a similarity search
// ("find relevant chunks"). All three chunk tables share the same {id, content, metadata,
// embedding} shape, so one generic function covers all of them.
export const getChunksByUser = (tableName: ChunkIndex, userId: string) =>
    supabaseClient
        .from(tableName)
        .select("id, content, metadata")
        .filter("metadata->>userId", "eq", userId)
        .order("id", { ascending: true });