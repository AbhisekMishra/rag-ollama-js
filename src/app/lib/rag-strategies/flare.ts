import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, flareDraftTemplate } from "../prompts";
import { llm } from "../ollama";
import { flareRetrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

// Named distinctly from draftChain's own "flareDraft" runName so the chat route can capture the
// literal rendered prompt/completion for this LLM call (see LLM_STAGE_RUNNAMES in route.ts).
const flareDraftLLM = llm.withConfig({ runName: "flareDraftLLM" });

const draftChain = RunnableSequence.from([
    flareDraftTemplate,
    flareDraftLLM,
    new StringOutputParser()
]).withConfig({ runName: "flareDraft" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// FLARE (Forward-Looking Active Retrieval), adapted to a single-answer-stream protocol: draft a
// tentative answer, check each sentence's confidence, and retrieve (using the sentence itself as
// the query) only for the ones the model isn't sure of, alongside the question's own retrieval.
// See flareLookahead in retrieval.ts for exactly how this differs from canonical FLARE.
export const flareChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        draft: draftChain,
        original: new RunnablePassthrough()
    },
    {
        retrieved: RunnableSequence.from([
            ({ draft, original }) => ({ question: original.question, draft }),
            flareRetrieveAndBuildContext(filter)
        ]),
        question: ({ original }) => original.question,
        history: ({ original }) => original.history,
    },
    {
        context: ({ retrieved }) => retrieved.context,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    answerChain
]);
