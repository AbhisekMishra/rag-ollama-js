import type { RagMode } from "./modes";

// Client-safe: no LangChain/LLM imports here, so this can be imported from UI components,
// same as modes.ts.

export type PipelineStageKind = "transform" | "retrieve" | "score" | "generate";

export interface PipelineStageMeta {
    // MUST match the runName the backend emits for this step (see rag-strategies/retrieval.ts,
    // condense.ts, multi-query.ts, hyde.ts, and api/chat/route.ts's STAGE_IDS) — this file and
    // the backend share one id namespace instead of a separate id-mapping table.
    id: string;
    label: string;
    what: string;
    why: string;
    kind: PipelineStageKind;
}

const vectorRetrieve: PipelineStageMeta = {
    id: "vectorRetrieve",
    label: "Vector Retrieval",
    what: "Embeds the query and finds the most similar chunks in the document by cosine similarity.",
    why: "This is the \"R\" in RAG: instead of relying on the model's training data, we search your actual document for the passages most likely to contain the answer.",
    kind: "retrieve",
};

const answerLLM: PipelineStageMeta = {
    id: "answerLLM",
    label: "Answer Generation",
    what: "The LLM reads the retrieved chunks as context and writes an answer, citing which chunk it used.",
    why: "Grounding the answer in retrieved text (rather than the model's memory) is what makes the response verifiable and reduces hallucination.",
    kind: "generate",
};

const sentenceVectorRetrieve: PipelineStageMeta = {
    id: "vectorRetrieve",
    label: "Sentence Retrieval",
    what: "Embeds the query and finds the most similar individual sentences (not paragraph chunks) in the document by cosine similarity.",
    why: "Embedding a whole paragraph blurs its meaning across every sentence in it, which can bury the one sentence that actually answers the question. Indexing single sentences gives a tighter, more precise match.",
    kind: "retrieve",
};

const childVectorRetrieve: PipelineStageMeta = {
    id: "vectorRetrieve",
    label: "Child Chunk Retrieval",
    what: "Embeds the query and finds the most similar small child chunks (not the full parent chunk) in the document by cosine similarity.",
    why: "A small, narrowly-scoped chunk embeds more precisely for a specific query than a large chunk whose meaning is blurred across several ideas — but it's too little context to answer from on its own, which the next step fixes.",
    kind: "retrieve",
};

export const RAG_PIPELINE_STAGES: Record<RagMode, PipelineStageMeta[]> = {
    naive: [
        vectorRetrieve,
        answerLLM,
    ],
    condense: [
        {
            id: "standaloneQuestion",
            label: "Question Condensing",
            what: "Rewrites your question plus the chat history into one standalone question.",
            why: "A follow-up like \"what about page 3?\" means nothing to a vector search on its own — resolving pronouns and references first lets retrieval work on a self-contained question.",
            kind: "transform",
        },
        vectorRetrieve,
        answerLLM,
    ],
    "multi-query": [
        {
            id: "generatePhrasings",
            label: "Generate Phrasings",
            what: "Asks the LLM for 4 alternative phrasings of your question, each using different vocabulary or angle.",
            why: "One phrasing of a question can miss the right chunk simply because its wording doesn't match the document's — casting a wider net hedges against that vocabulary mismatch.",
            kind: "transform",
        },
        {
            id: "vectorRetrieveMany",
            label: "Retrieve Per Phrasing",
            what: "Runs vector retrieval for the original question and all 4 phrasings in parallel.",
            why: "Each phrasing is a separate shot at matching the document's wording, retrieved concurrently rather than one after another.",
            kind: "retrieve",
        },
        {
            id: "dedupeCandidates",
            label: "Dedupe Chunks",
            what: "Unions the results from every phrasing and removes exact duplicate chunks.",
            why: "The same chunk often matches several phrasings — without deduping, the LLM would see (and could cite) the same text twice under two different source numbers.",
            kind: "score",
        },
        answerLLM,
    ],
    hyde: [
        {
            id: "hydeDraft",
            label: "HyDE Draft",
            what: "The LLM writes a short hypothetical passage that plausibly answers the question — facts don't need to be correct, only the style.",
            why: "Questions and answers live in different regions of embedding space: documents sound like answers, not questions. Embedding a fake answer lands closer to the real chunks than embedding the question would.",
            kind: "transform",
        },
        vectorRetrieve,
        answerLLM,
    ],
    hybrid: [
        {
            id: "hybridSearch",
            label: "Hybrid Search",
            what: "Runs full-text keyword search and vector search side by side, then fuses the two rankings with reciprocal rank fusion (RRF).",
            why: "Cosine similarity alone misses exact keyword/acronym matches that full-text search nails, and full-text alone misses paraphrases that embeddings nail — fusing both covers each other's blind spots.",
            kind: "retrieve",
        },
        answerLLM,
    ],
    rerank: [
        {
            id: "overFetchCandidates",
            label: "Over-fetch Candidates",
            what: "Retrieves 20 candidate chunks by vector similarity instead of the usual 4.",
            why: "Vector similarity is a cheap proxy for relevance and sometimes wrong — casting a wider net first gives the next step more to choose from.",
            kind: "retrieve",
        },
        {
            id: "scoreCandidates",
            label: "LLM Re-scoring",
            what: "Asks the LLM to directly score each of the 20 candidates' relevance to the question (0–1), then keeps only the top 4.",
            why: "A direct relevance judgment from the LLM can catch cases where a tangentially-related chunk out-ranked one that actually answers the question — at the cost of 20 extra LLM calls per query.",
            kind: "score",
        },
        answerLLM,
    ],
    "contextual-compression": [
        vectorRetrieve,
        {
            id: "compressChunks",
            label: "Contextual Compression",
            what: "Asks the LLM to strip each retrieved chunk down to only the sentences relevant to the question.",
            why: "A retrieved chunk is often a mix of relevant and irrelevant sentences — the irrelevant ones are just noise the answer LLM has to read past, and can distract it into citing text that doesn't really support the answer.",
            kind: "score",
        },
        answerLLM,
    ],
    "sentence-window": [
        sentenceVectorRetrieve,
        {
            id: "expandWindow",
            label: "Expand to Window",
            what: "Swaps each retrieved sentence for a window of it plus the 2 sentences before and after, precomputed at ingestion time.",
            why: "A single matched sentence is usually too little context to answer from on its own — expanding it back out to its surrounding sentences restores the context lost by indexing at sentence granularity.",
            kind: "score",
        },
        answerLLM,
    ],
    "parent-document": [
        childVectorRetrieve,
        {
            id: "expandToParent",
            label: "Expand to Parent",
            what: "Swaps each retrieved child chunk for its full parent chunk (~1000 characters), precomputed at ingestion time.",
            why: "A small child chunk is often too narrow to answer from on its own — expanding back out to the parent chunk restores the surrounding context lost by indexing at child granularity. Multiple child hits under the same parent are deduped so it isn't cited twice.",
            kind: "score",
        },
        answerLLM,
    ],
    "auto-merging": [
        childVectorRetrieve,
        {
            id: "autoMergeChunks",
            label: "Auto-Merge Siblings",
            what: "Groups the retrieved child chunks by their shared parent, and only merges a group up to its full parent chunk if at least 2 sibling children were retrieved together — a lone hit stays at child granularity.",
            why: "Parent-document retrieval always expands every hit, even a single narrow match. Requiring corroborating sibling evidence before promoting to the full parent avoids pulling in a whole chunk's worth of extra context on the strength of one match.",
            kind: "score",
        },
        answerLLM,
    ],
    "self-rag": [
        {
            id: "judgeSufficiency",
            label: "Retrieve + Judge Sufficiency",
            what: "Retrieves for the question, then asks the LLM to score (0–1) whether the retrieved context is actually sufficient to answer it. If not, and a hop remains, rewrites the question and retries — up to 2 hops.",
            why: "Retrieval can come back thin or off-target. Checking sufficiency before generating (rather than after) lets a bad retrieval be corrected by rewriting the query, without needing to regenerate the final answer.",
            kind: "retrieve",
        },
        answerLLM,
        {
            id: "critiqueGroundedness",
            label: "Critique Groundedness",
            what: "After the answer is generated, asks the LLM to score (0–1) how well it's actually supported by the retrieved context.",
            why: "This is a reported score, not a retry gate — regenerating the answer to act on this critique would mean a second LLM call and a duplicated/broken streamed response. It's shown so you can see when the model answered beyond what the context actually supports.",
            kind: "score",
        },
    ],
    crag: [
        {
            id: "cragGrade",
            label: "Grade + Retry",
            what: "Over-fetches 20 candidates and scores each one's relevance (0–1), same as re-ranking. If none clear the relevance bar, rewrites the question and retries once before falling back to the best-scoring attempt.",
            why: "Vector similarity sometimes surfaces nothing actually relevant — rather than answering from a bad context anyway (or just dropping low scorers like plain re-ranking does), a corrective retry gives the query a second chance to find something usable.",
            kind: "score",
        },
        answerLLM,
    ],
};
