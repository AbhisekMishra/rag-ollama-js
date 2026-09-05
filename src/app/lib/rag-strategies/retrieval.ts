import { RunnableSequence, RunnableLambda, RunnablePassthrough } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { DocumentInterface } from "@langchain/core/documents";

import { retriever, hybridSearcher, sentenceRetriever, childRetriever } from "../supabase";
import { buildContext } from "../../utils/helpers";
import { llm } from "../ollama";
import { rerankTemplate, compressionTemplate, contextSufficiencyTemplate, selfRagRewriteTemplate, cragRewriteTemplate } from "../prompts";

// Retrieval piped into citation-context building — composed, not hand-orchestrated with
// async/await — as one named runnable step shared by every strategy, so the chat route can
// read its `sources` output via `.streamEvents()` as soon as it finishes, ahead of the answer
// tokens that follow later in the same chain.
export const retrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    retriever(filter).withConfig({ runName: "vectorRetrieve" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

// The same chunk often matches several phrasings of one question, so a multi-query union
// must dedupe before numbering sources — otherwise the LLM would see (and cite) the same
// text under two different [Source N] labels.
function dedupeDocuments(docGroups: DocumentInterface[][]): DocumentInterface[] {
    const seen = new Set<string>();
    return docGroups.flat().filter((doc) => {
        if (seen.has(doc.pageContent)) return false;
        seen.add(doc.pageContent);
        return true;
    });
}

// Multi-query variant: takes a list of query phrasings, retrieves for each concurrently
// (`.batch()` fans the retriever out over the list), unions and dedupes the chunks, then
// builds citation context. Carries the same runName as the single-query version so the
// chat route's `sources` extraction works identically for every strategy.
export const retrieveManyAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    RunnableLambda.from((queries: string[]) => retriever(filter).batch(queries)).withConfig({ runName: "vectorRetrieveMany" }),
    RunnableLambda.from(dedupeDocuments).withConfig({ runName: "dedupeCandidates" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

// Hybrid variant: keyword + vector search fused in-database by the hybrid_search RPC
// (see supabase.ts / supabaseScripts.txt STEP 9). Same runName convention as above.
export const hybridRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    RunnableLambda.from(hybridSearcher(filter)).withConfig({ runName: "hybridSearch" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

const RERANK_FETCH_COUNT = 20;
const RERANK_KEEP_COUNT = 4;

const rerankScoreChain = RunnableSequence.from([
    rerankTemplate,
    llm,
    new StringOutputParser(),
]);

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

// Ollama has no cross-encoder model, so "re-ranking" here means asking the chat LLM to
// pointwise-score each candidate's relevance (0-1) against the question, one call per chunk.
// These 20 calls run outside the outer chain's traced execution (a bare .invoke() with no
// config/callbacks threaded through), so they never reach `chain.streamEvents()` in route.ts
// no matter what runName they're given — the prompt/completion has to be captured here
// directly and carried out as data, not surfaced via the streaming instrumentation.
async function scoreRelevance(question: string, doc: DocumentInterface): Promise<{ score: number; prompt: string; completion: string }> {
    const prompt = await rerankTemplate.format({ question, passage: doc.pageContent });
    const completion = await rerankScoreChain.invoke({ question, passage: doc.pageContent });
    return { score: clamp01(parseFloat(completion)), prompt, completion };
}

export interface ScoredCandidate {
    snippet: string;
    pageNumber: number;
    score: number;
    kept: boolean;
    prompt: string;
    completion: string;
}

// Scores every candidate and returns the full ranked table (so the pipeline visualizer can show
// which candidates were dropped, not just the ones that survived, plus each one's raw LLM
// prompt/response) alongside the kept documents.
async function scoreCandidates(question: string, docs: DocumentInterface[]): Promise<{ table: ScoredCandidate[]; kept: DocumentInterface[] }> {
    const scored = await Promise.all(docs.map((doc) => scoreRelevance(question, doc)));
    const ranked = docs
        .map((doc, index) => ({ doc, ...scored[index] }))
        .sort((a, b) => b.score - a.score);
    const kept = ranked.slice(0, RERANK_KEEP_COUNT).map(({ doc }) => doc);
    const keptSet = new Set(kept);
    const table = ranked.map(({ doc, score, prompt, completion }) => ({
        snippet: doc.pageContent.slice(0, 160),
        pageNumber: doc.metadata?.pageNumber ?? 0,
        score,
        kept: keptSet.has(doc),
        prompt,
        completion,
    }));
    return { table, kept };
}

// Re-ranking: vector similarity is a cheap proxy for relevance and sometimes wrong — it can
// rank a tangentially-related chunk above one that actually answers the question. Over-fetch
// a wider candidate pool (20) by cosine similarity, have the LLM score each one directly
// against the question, and keep only the top 4 by that score. Split into two named steps
// (rather than one hand-rolled async function) so the chat route can surface the over-fetch
// count and the full scored table — including the dropped candidates — via streamEvents().
export const rerankRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    RunnableLambda.from(async (question: string) => {
        const candidates = await retriever(filter, RERANK_FETCH_COUNT).invoke(question);
        return { question, candidates };
    }).withConfig({ runName: "overFetchCandidates" }),
    RunnableLambda.from(({ question, candidates }: { question: string; candidates: DocumentInterface[] }) =>
        scoreCandidates(question, candidates)
    ).withConfig({ runName: "scoreCandidates" }),
    ({ kept }: { table: ScoredCandidate[]; kept: DocumentInterface[] }) => kept,
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

const compressionChain = RunnableSequence.from([
    compressionTemplate,
    llm,
    new StringOutputParser(),
]);

interface CompressibleDoc {
    pageContent: string;
    metadata?: { pageNumber?: number };
}

export interface CompressedChunk {
    pageNumber: number;
    original: string;
    compressed: string;
    reduced: boolean;
    prompt: string;
    completion: string;
}

// Same limitation as scoreRelevance above: a bare .invoke() outside the parent chain's traced
// execution, so the prompt/completion is captured here directly rather than via streamEvents().
async function compressChunk(question: string, doc: DocumentInterface): Promise<{ doc: CompressibleDoc; row: CompressedChunk }> {
    const prompt = await compressionTemplate.format({ question, passage: doc.pageContent });
    const completion = await compressionChain.invoke({ question, passage: doc.pageContent });
    const trimmed = completion.trim();
    // Never let a chunk collapse to nothing — if the LLM strips every sentence, fall back to
    // the original rather than handing the answer step an empty, uncited source.
    const keptContent = trimmed || doc.pageContent;
    return {
        doc: { pageContent: keptContent, metadata: doc.metadata },
        row: {
            pageNumber: doc.metadata?.pageNumber ?? 0,
            original: doc.pageContent.slice(0, 200),
            compressed: keptContent.slice(0, 200),
            reduced: trimmed.length > 0 && trimmed.length < doc.pageContent.length,
            prompt,
            completion,
        },
    };
}

async function compressCandidates(question: string, docs: DocumentInterface[]): Promise<{ table: CompressedChunk[]; compressed: CompressibleDoc[] }> {
    const results = await Promise.all(docs.map((doc) => compressChunk(question, doc)));
    return {
        table: results.map((result) => result.row),
        compressed: results.map((result) => result.doc),
    };
}

// Contextual compression: a retrieved chunk is often a mix of relevant and irrelevant
// sentences — the irrelevant ones are just noise the answer LLM has to read past (and can
// distract it into citing text that doesn't actually support the answer). Strip each chunk
// down to only the sentences relevant to the question before it reaches the answer prompt.
// The first step is a parallel branch (retrieve the docs, passthrough the question) rather than
// a custom lambda like overFetchCandidates' — that keeps its input/output shape identical to
// the plain retriever step other modes name "vectorRetrieve", so it can share that runName
// (and the pipeline visualizer's shared "Vector Retrieval" stage copy) instead of needing its own.
export const compressRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    {
        docs: retriever(filter).withConfig({ runName: "vectorRetrieve" }),
        question: new RunnablePassthrough<string>(),
    },
    RunnableLambda.from(({ question, docs }: { question: string; docs: DocumentInterface[] }) =>
        compressCandidates(question, docs)
    ).withConfig({ runName: "compressChunks" }),
    ({ compressed }: { table: CompressedChunk[]; compressed: CompressibleDoc[] }) => compressed,
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

// Sentence-window retrieval matched on individual sentences (tighter embeddings than a
// paragraph chunk, so retrieval precision improves), but a bare sentence is too little
// context to answer from — swap each hit's pageContent for its precomputed window
// (buildSentenceWindowDocuments in ../sentence-window.ts) before building citation context.
// Adjacent sentence hits can expand into identical or overlapping windows, so dedupe by the
// resulting window text, same pattern as dedupeDocuments above.
function expandToWindow(docs: DocumentInterface[]): CompressibleDoc[] {
    const seen = new Set<string>();
    const expanded: CompressibleDoc[] = [];
    for (const doc of docs) {
        const windowText = (doc.metadata?.windowText as string | undefined) ?? doc.pageContent;
        if (seen.has(windowText)) continue;
        seen.add(windowText);
        expanded.push({ pageContent: windowText, metadata: doc.metadata });
    }
    return expanded;
}

// Sentence-window variant: retrieves against sentence-level embeddings (sentenceRetriever,
// sentence_documents table — see supabase.ts / supabaseScripts.txt STEP 10) instead of the
// paragraph-level documents table, then expands each hit to its surrounding window before
// building citation context. The retrieve step reuses the "vectorRetrieve" runName and stays
// bare Document[] output (same guardrail compressRetrieveAndBuildContext follows above), so
// expansion is a second, distinctly-named step rather than folded into the retriever itself.
export const sentenceWindowRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    sentenceRetriever(filter).withConfig({ runName: "vectorRetrieve" }),
    RunnableLambda.from(expandToWindow).withConfig({ runName: "expandWindow" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

// Parent-document retrieval matched on small child chunks (tighter embeddings than a full
// ~1000-char parent chunk, so retrieval precision improves), but a bare child chunk is often
// too narrow to answer from — swap each hit's pageContent for its precomputed parent chunk
// text (buildChildDocuments in ../parent-document.ts) before building citation context.
// Multiple child hits often share the same parent, so dedupe by the resulting parent text,
// same pattern as expandToWindow above.
function expandToParent(docs: DocumentInterface[]): CompressibleDoc[] {
    const seen = new Set<string>();
    const expanded: CompressibleDoc[] = [];
    for (const doc of docs) {
        const parentText = (doc.metadata?.parentText as string | undefined) ?? doc.pageContent;
        if (seen.has(parentText)) continue;
        seen.add(parentText);
        expanded.push({ pageContent: parentText, metadata: doc.metadata });
    }
    return expanded;
}

// Parent-document variant: retrieves against child-chunk-level embeddings (childRetriever,
// child_documents table — see supabase.ts / supabaseScripts.txt STEP 11) instead of the
// paragraph-level documents table, then expands each hit to its full parent chunk before
// building citation context. The retrieve step reuses the "vectorRetrieve" runName and stays
// bare Document[] output (same guardrail compressRetrieveAndBuildContext/sentence-window
// follow above), so expansion is a second, distinctly-named step rather than folded into the
// retriever itself.
export const parentDocumentRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    childRetriever(filter).withConfig({ runName: "vectorRetrieve" }),
    RunnableLambda.from(expandToParent).withConfig({ runName: "expandToParent" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

// Auto-merging retrieval reuses the same child_documents table as parent-document retrieval —
// the difference is retrieval-side policy, not storage. Parent-document always promotes every
// hit to its full parent; auto-merging only promotes a parent when enough of its *sibling*
// children were independently retrieved (real evidence several narrow matches agree on the
// same parent), otherwise it's cheaper/tighter to leave a lone hit at child granularity rather
// than pull in a whole parent chunk on the strength of one match.
const AUTO_MERGE_FETCH_COUNT = 12;
const AUTO_MERGE_THRESHOLD = 2;

function autoMergeChunks(docs: DocumentInterface[]): CompressibleDoc[] {
    const groups = new Map<string, DocumentInterface[]>();
    for (const doc of docs) {
        const parentText = (doc.metadata?.parentText as string | undefined) ?? doc.pageContent;
        const group = groups.get(parentText);
        if (group) group.push(doc);
        else groups.set(parentText, [doc]);
    }
    const merged: CompressibleDoc[] = [];
    for (const [parentText, siblings] of groups) {
        if (siblings.length >= AUTO_MERGE_THRESHOLD) {
            merged.push({ pageContent: parentText, metadata: siblings[0].metadata });
        } else {
            for (const doc of siblings) merged.push({ pageContent: doc.pageContent, metadata: doc.metadata });
        }
    }
    return merged;
}

// Auto-merging variant: over-fetches child-chunk-level candidates (more than parent-document's
// single-hit-per-parent assumption needs, so enough siblings under the same parent have a
// chance to show up together), then merges only the parents with enough retrieved sibling
// evidence — see autoMergeChunks above.
export const autoMergeRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    childRetriever(filter, AUTO_MERGE_FETCH_COUNT).withConfig({ runName: "vectorRetrieve" }),
    RunnableLambda.from(autoMergeChunks).withConfig({ runName: "autoMergeChunks" }),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });

const sufficiencyChain = RunnableSequence.from([
    contextSufficiencyTemplate,
    llm,
    new StringOutputParser(),
]);

const selfRagRewriteChain = RunnableSequence.from([
    selfRagRewriteTemplate,
    llm,
    new StringOutputParser(),
]);

export interface SelfRagAttempt {
    hop: number;
    query: string;
    score: number;
    prompt: string;
    completion: string;
}

// Same "bare .invoke() never enters the traced graph" limitation as scoreRelevance/compressChunk
// above — this is a pre-generation judgment call, not the streamed answer, so it doesn't need to.
async function judgeSufficiency(question: string, context: string): Promise<{ score: number; prompt: string; completion: string }> {
    const prompt = await contextSufficiencyTemplate.format({ question, context });
    const completion = await sufficiencyChain.invoke({ question, context });
    return { score: clamp01(parseFloat(completion)), prompt, completion };
}

const SELF_RAG_MAX_HOPS = 2;
const SELF_RAG_SUFFICIENCY_THRESHOLD = 0.5;

// Self-RAG's "capped hops" apply here, on the retrieval side: judge whether the retrieved
// context is even sufficient to answer the question, and if not (and hops remain), rewrite the
// query and retry. This is deliberately kept pre-generation — gating on a *post-hoc* critique of
// the generated answer would require regenerating it, which would mean a second `answerLLM` call
// and a broken/duplicated token stream to the client (see self-rag.ts for the groundedness half,
// which runs once, after the single streamed answer, as a reported score rather than a retry gate).
async function selfRagRetrieve(filter: Record<string, unknown>, question: string): Promise<{ docs: DocumentInterface[]; attempts: SelfRagAttempt[] }> {
    let query = question;
    let hop = 0;
    const attempts: SelfRagAttempt[] = [];
    let docs: DocumentInterface[] = [];
    let judgment: { score: number; prompt: string; completion: string };
    while (true) {
        docs = await retriever(filter).invoke(query);
        const { context } = buildContext(docs);
        judgment = await judgeSufficiency(question, context);
        attempts.push({ hop, query, ...judgment });
        if (judgment.score >= SELF_RAG_SUFFICIENCY_THRESHOLD || hop >= SELF_RAG_MAX_HOPS) break;
        query = await selfRagRewriteChain.invoke({ question, context });
        hop += 1;
    }
    return { docs, attempts };
}

// Wraps the bounded judge/retry loop as one named step so the pipeline visualizer can show every
// hop's query/score, then builds citation context from whichever hop's docs were finally kept.
// `sources` stays at the top level of the output (alongside `context`/`attempts`) so route.ts's
// generic `retrieveAndBuildContext` sources extraction keeps working unchanged.
export const selfRagRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    RunnableLambda.from((question: string) => selfRagRetrieve(filter, question)).withConfig({ runName: "judgeSufficiency" }),
    RunnableLambda.from(({ docs, attempts }: { docs: DocumentInterface[]; attempts: SelfRagAttempt[] }) => ({ ...buildContext(docs), attempts })),
]).withConfig({ runName: "retrieveAndBuildContext" });

const cragRewriteChain = RunnableSequence.from([
    cragRewriteTemplate,
    llm,
    new StringOutputParser(),
]);

export interface CragAttempt {
    attempt: number;
    query: string;
    table: ScoredCandidate[];
}

const CRAG_MAX_RETRIES = 1;
const CRAG_RELEVANCE_THRESHOLD = 0.5;

// CRAG: grade every retrieved candidate's relevance (reusing rerank's scoreCandidates —
// exact same over-fetch-then-pointwise-score approach, just gating a retry on it rather than
// only dropping low scorers) and, if NONE of them clear the relevance bar, rewrite the query and
// retry once before falling back to whichever attempt scored best.
async function cragRetrieve(filter: Record<string, unknown>, question: string): Promise<{ kept: DocumentInterface[]; attempts: CragAttempt[] }> {
    let query = question;
    let attempt = 0;
    const attempts: CragAttempt[] = [];
    let best: { table: ScoredCandidate[]; kept: DocumentInterface[] } | undefined;
    let bestScore = -1;
    while (true) {
        const candidates = await retriever(filter, RERANK_FETCH_COUNT).invoke(query);
        const result = await scoreCandidates(question, candidates);
        attempts.push({ attempt, query, table: result.table });
        const maxScore = Math.max(0, ...result.table.map((row) => row.score));
        if (maxScore > bestScore) {
            best = result;
            bestScore = maxScore;
        }
        if (maxScore >= CRAG_RELEVANCE_THRESHOLD || attempt >= CRAG_MAX_RETRIES) break;
        query = await cragRewriteChain.invoke({ question, passages: result.table.map((row) => row.snippet).join("\n") });
        attempt += 1;
    }
    return { kept: best!.kept, attempts };
}

// Wraps the bounded grade/retry loop as one named step so the pipeline visualizer can show every
// attempt's scored candidate table, then builds citation context from the best attempt's kept docs.
export const cragRetrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    RunnableLambda.from((question: string) => cragRetrieve(filter, question)).withConfig({ runName: "cragGrade" }),
    RunnableLambda.from(({ kept, attempts }: { kept: DocumentInterface[]; attempts: CragAttempt[] }) => ({ ...buildContext(kept), attempts })),
]).withConfig({ runName: "retrieveAndBuildContext" });

// Multi-hop's citation context differs from multi-query's: multi-query flattens every
// phrasing's hits into one undifferentiated deduped pool, but multi-hop keeps each
// sub-question's chunks grouped and attributed under a "Sub-question K" header, so the answer
// LLM can reason across hops explicitly instead of pattern-matching a merged blob. Citation
// numbering/dedup still follows buildContext's exact contract (global 1..N, deduped by
// pageContent, parallel {id, pageNumber} sources list) — just rendered with sub-question headers.
function buildMultiHopContext(subQuestions: string[], docGroups: DocumentInterface[][]): { context: string; sources: { id: number; pageNumber: number }[] } {
    const sourceNumbers = new Map<string, number>();
    const orderedDocs: DocumentInterface[] = [];
    const sections = subQuestions.map((subQuestion, i) => {
        const lines = (docGroups[i] ?? []).map((doc) => {
            let number = sourceNumbers.get(doc.pageContent);
            if (number === undefined) {
                number = orderedDocs.length + 1;
                sourceNumbers.set(doc.pageContent, number);
                orderedDocs.push(doc);
            }
            return `[Source ${number} | Page ${doc.metadata?.pageNumber ?? 0}]\n${doc.pageContent}`;
        });
        return `Sub-question ${i + 1}: ${subQuestion}\n${lines.join("\n\n")}`;
    });
    return {
        context: sections.join("\n\n"),
        sources: orderedDocs.map((doc, index) => ({ id: index + 1, pageNumber: doc.metadata?.pageNumber ?? 0 })),
    };
}

// Multi-hop variant: fans retrieval out over the decomposed sub-questions (reuses the exact same
// {list}->Document[][] shape as retrieveManyAndBuildContext's "vectorRetrieveMany" step, so the
// pipeline visualizer's shared stage copy/shapeStageData case applies here too), carrying the
// sub-questions alongside via a parallel branch (same pattern compressRetrieveAndBuildContext
// uses to carry the question alongside its retrieved docs) so buildMultiHopContext can label
// each group. Named "buildHopContext" rather than reusing "dedupeCandidates" since the output
// shape differs — grouped/labeled context text, not a flat deduped Document[].
export const retrieveMultiHopAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    {
        docGroups: RunnableLambda.from((subQuestions: string[]) => retriever(filter).batch(subQuestions)).withConfig({ runName: "vectorRetrieveMany" }),
        subQuestions: new RunnablePassthrough<string[]>(),
    },
    RunnableLambda.from(({ docGroups, subQuestions }: { docGroups: DocumentInterface[][]; subQuestions: string[] }) =>
        buildMultiHopContext(subQuestions, docGroups)
    ).withConfig({ runName: "buildHopContext" }),
]).withConfig({ runName: "retrieveAndBuildContext" });
