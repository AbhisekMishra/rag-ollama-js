import type { RunnableSequence } from "@langchain/core/runnables";

import { condenseChain } from "./condense";
import { naiveChain } from "./naive";
import { multiQueryChain } from "./multi-query";
import { hydeChain } from "./hyde";
import { hybridChain } from "./hybrid";
import { rerankChain } from "./rerank";
import { contextualCompressionChain } from "./contextual-compression";
import { sentenceWindowChain } from "./sentence-window";
import { parentDocumentChain } from "./parent-document";
import { autoMergingChain } from "./auto-merging";
import { selfRagChain } from "./self-rag";
import { cragChain } from "./crag";
import { agenticChain } from "./agentic";
import { multiHopChain } from "./multi-hop";
import type { RagStrategy } from "./types";
import { DEFAULT_RAG_MODE, type RagMode } from "./modes";

export { DEFAULT_RAG_MODE, RAG_MODES } from "./modes";
export type { RagMode } from "./modes";

export const RAG_STRATEGIES: Record<RagMode, RagStrategy> = {
    naive: naiveChain,
    condense: condenseChain,
    "multi-query": multiQueryChain,
    hyde: hydeChain,
    hybrid: hybridChain,
    rerank: rerankChain,
    "contextual-compression": contextualCompressionChain,
    "sentence-window": sentenceWindowChain,
    "parent-document": parentDocumentChain,
    "auto-merging": autoMergingChain,
    "self-rag": selfRagChain,
    crag: cragChain,
    agentic: agenticChain,
    "multi-hop": multiHopChain,
};

export function buildRagChain(mode: RagMode, filter: Record<string, unknown>): RunnableSequence {
    const strategy = RAG_STRATEGIES[mode] ?? RAG_STRATEGIES[DEFAULT_RAG_MODE];
    return strategy(filter);
}
