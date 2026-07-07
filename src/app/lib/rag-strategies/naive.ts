import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate } from "../prompts";
import { llm } from "../ollama";
import { retrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

// Named so the chat route can pick this LLM's token-stream events out of `.streamEvents()`.
const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Control group: embed the raw question, retrieve, answer. No condensing, no rewriting —
// the yardstick every other strategy in the registry is measured against.
export const naiveChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        retrieved: RunnableSequence.from([
            ({ question }) => question,
            retrieveAndBuildContext(filter)
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
