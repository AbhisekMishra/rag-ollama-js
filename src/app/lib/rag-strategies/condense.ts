import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, standaloneTemplate } from "../prompts";
import { llm } from "../ollama";
import { retrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

// Named so the chat route can pick this LLM's token-stream events out of `.streamEvents()`
// without also picking up the standalone-question rewrite below.
const answerLLM = llm.withConfig({ runName: "answerLLM" });

const promptChain = RunnableSequence.from([
    standaloneTemplate,
    llm,
    new StringOutputParser()
]);

const retrieverChain = (filter: Record<string, unknown>) => RunnableSequence.from([
    (result: { standaloneQuestion: string }) => result.standaloneQuestion,
    retrieveAndBuildContext(filter)
]);

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Condense (question + history) into a standalone question before retrieving — handles
// follow-up/pronoun references ("what about page 3?") that a raw-question embed would miss.
export const condenseChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        standaloneQuestion: promptChain,
        originalQuestion: new RunnablePassthrough()
    },
    {
        retrieved: retrieverChain(filter),
        question: ({ originalQuestion }) => originalQuestion.question,
        history: ({ originalQuestion }) => originalQuestion.history,
    },
    {
        context: ({ retrieved }) => retrieved.context,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    answerChain
]);
