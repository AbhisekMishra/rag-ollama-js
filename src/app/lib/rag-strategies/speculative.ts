import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate } from "../prompts";
import { llm } from "../ollama";
import { speculativeRetrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Speculative RAG: one retrieval pass on the raw question (isolating the change against `naive`),
// but the retrieved pool is split into subsets, a draft answer is written from each in parallel,
// and a verifier picks the best draft — contrasting with RAG-Fusion's multiple-retrieval/
// single-generation shape. The winning draft's evidence subset becomes the context for the single
// streamed answerLLM call (see speculativeSelect in retrieval.ts for why the draft itself isn't
// returned as the answer).
export const speculativeChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        retrieved: RunnableSequence.from([
            ({ question }) => question,
            speculativeRetrieveAndBuildContext(filter)
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
