import type { ChunkIndex } from "./chunk-index";

export interface ChunkStrategyMeta {
    label: string;
    description: string;
    config: { label: string; value: string }[];
}

// Static UI copy describing how each chunk index was produced (client-safe, like
// rag-strategies/pipeline-metadata.ts). Config values are the hardcoded constants from the
// ingestion code (api/document/route.ts, lib/sentence-window.ts, lib/parent-document.ts) —
// not derived from the DB, since chunk size/overlap/window aren't stored per row.
export const CHUNK_STRATEGY_META: Record<ChunkIndex, ChunkStrategyMeta> = {
    documents: {
        label: "Naive Chunking",
        description: "The document is split into fixed-size overlapping chunks by RecursiveCharacterTextSplitter, breaking preferentially on paragraph/line/word boundaries. This is the main index every RAG mode retrieves from unless it uses one of the two specialized indexes below.",
        config: [
            { label: "Chunk size", value: "1000 characters" },
            { label: "Chunk overlap", value: "100 characters" },
            { label: "Separators", value: '"\\n\\n", "\\n", " ", ""' },
        ],
    },
    sentence_documents: {
        label: "Sentence-Window Chunking",
        description: "Each page is further split into individual sentences (regex-based, not real NLP segmentation) and each sentence is embedded on its own — a tighter, more precise embedding than a whole paragraph. A window of neighboring sentences around each one is precomputed and stored so the answer LLM still gets surrounding context at query time. Used by the \"Sentence-Window Retrieval\" RAG mode.",
        config: [
            { label: "Granularity", value: "1 row per sentence" },
            { label: "Window size", value: "±2 sentences (5 total)" },
        ],
    },
    child_documents: {
        label: "Parent-Document Chunking",
        description: "Each ~1000-char chunk from the naive index is further split into smaller \"child\" chunks and each child is embedded on its own — narrower and more precisely matched to specific queries than the full parent chunk. The full parent chunk text is precomputed and stored so the answer LLM still gets full surrounding context at query time. Used by the \"Parent-Document Retrieval\" RAG mode.",
        config: [
            { label: "Child chunk size", value: "200 characters" },
            { label: "Child chunk overlap", value: "20 characters" },
        ],
    },
    raptor_documents: {
        label: "RAPTOR Summary Tree",
        description: "The naive chunks are clustered by embedding similarity and each cluster is summarized by the LLM; those summaries are clustered and summarized again, recursively, until one root remains. Only the summary nodes are stored here (the leaves are the naive index above). A broad question can then match a high-level summary while a narrow one matches a leaf. A summary's page is its earliest member page. Used by the \"RAPTOR\" RAG mode.",
        config: [
            { label: "Cluster size", value: "~5 nodes per summary" },
            { label: "Max levels", value: "3 summary levels" },
            { label: "Clustering", value: "cosine k-means (deterministic)" },
        ],
    },
};
