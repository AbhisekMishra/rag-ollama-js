import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate } from "../prompts";
import { llm } from "../ollama";
import { ragFusionRetrieveAndBuildContext } from "./retrieval";
import { rephraseChain } from "./multi-query";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// RAG-Fusion: multi-query's phrasing generation + fan-out, but the per-phrasing ranked lists are
// merged with reciprocal rank fusion instead of deduped-and-concatenated. A chunk that ranks well
// for several phrasings is stronger evidence than one that topped a single list, and RRF rewards
// exactly that — while trimming back to 4 chunks keeps the isolated variable against `multi-query`
// the fusion step, not a larger context.
export const ragFusionChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        phrasings: rephraseChain,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        retrieved: RunnableSequence.from([
            ({ question, phrasings }) => [question, ...phrasings],
            ragFusionRetrieveAndBuildContext(filter),
        ]),
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        context: ({ retrieved }) => retrieved.context,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    answerChain
]);
