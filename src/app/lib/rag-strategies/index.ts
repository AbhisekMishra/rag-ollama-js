import type { RunnableSequence } from "@langchain/core/runnables";

import { condenseChain } from "./condense";
import { naiveChain } from "./naive";
import type { RagStrategy } from "./types";
import { DEFAULT_RAG_MODE, type RagMode } from "./modes";

export { DEFAULT_RAG_MODE, RAG_MODES } from "./modes";
export type { RagMode } from "./modes";

export const RAG_STRATEGIES: Record<RagMode, RagStrategy> = {
    naive: naiveChain,
    condense: condenseChain,
};

export function buildRagChain(mode: RagMode, filter: Record<string, unknown>): RunnableSequence {
    const strategy = RAG_STRATEGIES[mode] ?? RAG_STRATEGIES[DEFAULT_RAG_MODE];
    return strategy(filter);
}
