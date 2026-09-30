import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, multiQueryTemplate } from "../prompts";
import { llm } from "../ollama";
import { retrieveManyAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

// Named so the chat route can pick this LLM's token-stream events out of `.streamEvents()`
// without also picking up the rephrasing generation below.
const answerLLM = llm.withConfig({ runName: "answerLLM" });

// Named distinctly from rephraseChain's own "generatePhrasings" runName so the chat route can
// capture the literal rendered prompt/completion for this LLM call (see LLM_STAGE_RUNNAMES in route.ts).
const rephraseLLM = llm.withConfig({ runName: "generatePhrasingsLLM" });

// The LLM is asked for one phrasing per line with no numbering, but small models add
// bullets/numbers anyway — strip them rather than let them pollute the embedding. Small
// models also sometimes emit the literal two-character escape "\n" instead of a real
// newline byte, collapsing every phrasing onto one line — split on either.
function parsePhrasings(raw: string): string[] {
    return raw
        .split(/\r?\n|\\n/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 5);
}

// Exported so rag-fusion.ts can reuse the exact same phrasing generation step.
export const rephraseChain = RunnableSequence.from([
    multiQueryTemplate,
    rephraseLLM,
    new StringOutputParser(),
    RunnableLambda.from(parsePhrasings),
]).withConfig({ runName: "generatePhrasings" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Multi-query RAG: one phrasing of a question can miss the right chunk simply because its
// vocabulary doesn't match the document's. Generate several rephrasings, retrieve for each
// in parallel (original question included as a safety net), and answer from the deduped
// union — hedging the embedding lottery at the cost of one extra LLM call.
export const multiQueryChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        phrasings: rephraseChain,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        retrieved: RunnableSequence.from([
            ({ question, phrasings }) => [question, ...phrasings],
            retrieveManyAndBuildContext(filter),
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
