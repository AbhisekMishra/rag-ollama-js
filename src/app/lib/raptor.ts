import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

import { llm, embeddings } from "./ollama";
import { raptorSummaryTemplate } from "./prompts";

// RAPTOR builds a tree over the document at ingestion time: leaves are the ~1000-char parent
// chunks, each level above is an LLM summary of a cluster of the level below, recursively, until
// one root remains. Retrieval can then match a broad question against a high-level summary and a
// narrow one against a leaf (see raptorRetrieveAndBuildContext in rag-strategies/retrieval.ts).
//
// Documented simplifications vs. the paper: clusters come from a small deterministic cosine
// k-means over the raw 768-d embeddings, not UMAP-reduced Gaussian mixture models with soft
// (multi-cluster) membership; and a summary's `pageNumber` is its earliest member page (with
// `pageMax` alongside), since a summary has no single page to cite.
export const RAPTOR_CLUSTER_SIZE = 5;
export const RAPTOR_MAX_LEVELS = 3;
const KMEANS_ITERATIONS = 10;
const MAX_SUMMARY_INPUT_CHARS = 6000;

interface TreeNode {
    text: string;
    vector: number[];
    pageMin: number;
    pageMax: number;
}

function normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
    return vector.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

// Deterministic spherical k-means (cosine similarity via normalized vectors): centroids start at
// evenly spaced input points, so the same document always clusters the same way — no random seed
// to make ingestion non-reproducible. Returns each vector's cluster index.
export function clusterVectors(vectors: number[][], k: number): number[] {
    const n = vectors.length;
    if (k <= 1 || n <= 1) return vectors.map(() => 0);
    const points = vectors.map(normalize);
    const kk = Math.min(k, n);
    let centroids = Array.from({ length: kk }, (_, c) => points[Math.floor((c * n) / kk)]);
    let assignments: number[] = new Array(n).fill(0);

    for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
        const next = points.map((point) => {
            let best = 0;
            let bestScore = -Infinity;
            centroids.forEach((centroid, c) => {
                const score = dot(point, centroid);
                if (score > bestScore) { bestScore = score; best = c; }
            });
            return best;
        });
        const changed = next.some((a, i) => a !== assignments[i]);
        assignments = next;

        centroids = centroids.map((old, c) => {
            const members = points.filter((_, i) => assignments[i] === c);
            if (members.length === 0) return old; // keep an emptied cluster's centroid rather than NaN it
            const mean = old.map((_, d) => members.reduce((sum, m) => sum + m[d], 0) / members.length);
            return normalize(mean);
        });
        if (!changed && iter > 0) break;
    }
    return assignments;
}

const summaryChain = RunnableSequence.from([raptorSummaryTemplate, llm, new StringOutputParser()]);

async function summarizeCluster(members: TreeNode[]): Promise<string> {
    let passages = members.map((m) => m.text).join("\n\n");
    if (passages.length > MAX_SUMMARY_INPUT_CHARS) passages = passages.slice(0, MAX_SUMMARY_INPUT_CHARS);
    return (await summaryChain.invoke({ passages })).trim();
}

// Builds every summary level above the given leaf chunks. Returns only the SUMMARY nodes (as
// Documents plus their embedding vectors) — the leaves already live in the `documents` table, and
// raptor retrieval unions a leaf search there with a summary search in `raptor_documents`, so
// storing leaves twice would just double the storage. Costs one extra embedding pass over the
// leaves (clustering needs their vectors and SupabaseVectorStore doesn't hand them back), plus
// roughly N/5 + N/25 + ... LLM summarization calls — the heaviest ingestion cost of any mode.
export async function buildRaptorTree(leaves: Document[]): Promise<{ docs: Document[]; vectors: number[][] }> {
    if (leaves.length < 2) return { docs: [], vectors: [] };

    const leafVectors = await embeddings.embedDocuments(leaves.map((leaf) => leaf.pageContent));
    let nodes: TreeNode[] = leaves.map((leaf, i) => {
        const page = (leaf.metadata?.pageNumber as number | undefined) ?? 0;
        return { text: leaf.pageContent, vector: leafVectors[i], pageMin: page, pageMax: page };
    });

    const documentName = leaves[0].metadata?.documentName;
    const userId = leaves[0].metadata?.userId;
    const docs: Document[] = [];
    const vectors: number[][] = [];

    for (let level = 1; level <= RAPTOR_MAX_LEVELS && nodes.length > 1; level++) {
        const k = Math.max(1, Math.ceil(nodes.length / RAPTOR_CLUSTER_SIZE));
        const assignments = clusterVectors(nodes.map((n) => n.vector), k);
        const clusters = new Map<number, TreeNode[]>();
        nodes.forEach((node, i) => {
            const group = clusters.get(assignments[i]);
            if (group) group.push(node);
            else clusters.set(assignments[i], [node]);
        });

        const next: TreeNode[] = [];
        for (const members of clusters.values()) {
            // A singleton cluster has nothing to summarize — carry it up unchanged (and don't
            // store it again as a summary) so it can still be grouped at the next level.
            if (members.length === 1) { next.push(members[0]); continue; }

            const summary = await summarizeCluster(members);
            if (!summary) { next.push(...members); continue; } // LLM returned nothing; don't store an empty node
            const pageMin = Math.min(...members.map((m) => m.pageMin));
            const pageMax = Math.max(...members.map((m) => m.pageMax));
            const [vector] = await embeddings.embedDocuments([summary]);

            docs.push(new Document({
                pageContent: summary,
                metadata: { documentName, userId, level, pageNumber: pageMin, pageMax, childCount: members.length },
            }));
            vectors.push(vector);
            next.push({ text: summary, vector, pageMin, pageMax });
        }

        if (next.length >= nodes.length) break; // no consolidation happened; stop rather than loop
        nodes = next;
    }

    return { docs, vectors };
}
