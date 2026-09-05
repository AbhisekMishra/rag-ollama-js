import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, subQuestionTemplate } from "../prompts";
import { llm } from "../ollama";
import { retrieveMultiHopAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

// Named so the chat route can pick this LLM's token-stream events out of `.streamEvents()`
// without also picking up the sub-question decomposition below.
const answerLLM = llm.withConfig({ runName: "answerLLM" });

// Named distinctly from the outer decomposeChain's own "decomposeQuestions" runName so the chat
// route can capture the literal rendered prompt/completion for this LLM call (see
// LLM_STAGE_RUNNAMES in route.ts).
const decomposeLLM = llm.withConfig({ runName: "decomposeQuestionsLLM" });

// Same parsing concerns as multi-query's parsePhrasings: the LLM is asked for one sub-question
// per line with no numbering, but small models add bullets/numbers or literal "\n" anyway.
function parseSubQuestions(raw: string): string[] {
    return raw
        .split(/\r?\n|\\n/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 4);
}

const decomposeChain = RunnableSequence.from([
    subQuestionTemplate,
    decomposeLLM,
    new StringOutputParser(),
    RunnableLambda.from(parseSubQuestions),
]).withConfig({ runName: "decomposeQuestions" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Multi-hop RAG: splits a compound question into sub-questions, retrieves separately for each
// (a simple/atomic question just comes back as a single sub-question, degrading gracefully to
// single-hop), and keeps each sub-question's chunks grouped and attributed in the context text
// rather than flattening them into one undifferentiated pool like multi-query does — letting the
// answer LLM reason across hops explicitly instead of pattern-matching a merged blob.
export const multiHopChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        subQuestions: decomposeChain,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        retrieved: RunnableSequence.from([
            ({ subQuestions }) => subQuestions,
            retrieveMultiHopAndBuildContext(filter),
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
