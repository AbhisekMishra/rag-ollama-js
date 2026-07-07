import { RunnableSequence } from "@langchain/core/runnables";

export type RagStrategy = (filter: Record<string, unknown>) => RunnableSequence;
