import { RunnableSequence, RunnableBranch, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { directAnswerTemplate, routeQueryTemplate } from "../prompts";
import { llm } from "../ollama";
import { naiveChain } from "./naive";
import { multiQueryChain } from "./multi-query";
import type { RagStrategy } from "./types";

type Route = "DIRECT" | "SINGLE" | "MULTI";

// Scoped to 3 options rather than a full 12-way pick across every registered mode — reliably
// classifying a question into that many categories with a small local Ollama model isn't
// realistic. DIRECT/SINGLE/MULTI still demonstrates both halves of "agentic" retrieval: whether
// to retrieve at all, and (if so) which retrieval mechanism to use.
function parseRoute(raw: string): Route {
    const cleaned = raw.trim().toUpperCase();
    if (cleaned.includes("DIRECT")) return "DIRECT";
    if (cleaned.includes("MULTI")) return "MULTI";
    return "SINGLE";
}

// Named distinctly from the outer routeChain's own "routeQuery" runName so the chat route can
// capture the literal rendered prompt/completion for this LLM call (see LLM_STAGE_RUNNAMES in route.ts).
const routeLLM = llm.withConfig({ runName: "routeQueryLLM" });

const routeChain = RunnableSequence.from([
    routeQueryTemplate,
    routeLLM,
    new StringOutputParser(),
    RunnableLambda.from(parseRoute),
]).withConfig({ runName: "routeQuery" });

// Named so the chat route can pick this LLM's token-stream events out of `.streamEvents()`
// for the DIRECT branch — SINGLE/MULTI branches stream via naiveChain's/multiQueryChain's own
// identically-named answerLLM instead.
const answerLLM = llm.withConfig({ runName: "answerLLM" });

// Widened to the bare `RunnableSequence` type (same convention `RagStrategy` uses) rather than
// the strict template-inferred input type — RunnableBranch requires every branch to share one
// input type, and naiveChain/multiQueryChain are already bare `RunnableSequence`s via `RagStrategy`.
const directChain: RunnableSequence = RunnableSequence.from([
    directAnswerTemplate,
    answerLLM,
    new StringOutputParser(),
]);

// Agentic/router RAG: an LLM call classifies the question, then a RunnableBranch (a first-class
// LangChain composition primitive, not hand-rolled if/else orchestration) dispatches to one of
// three existing, already-exported strategies — answer directly with no retrieval at all,
// delegate to `naiveChain` for a single focused retrieval, or delegate to `multiQueryChain` for
// a broader multi-phrasing fan-out. Delegating to the existing chains (rather than re-implementing
// retrieval logic here) means whichever branch runs still emits the same named
// retrieveAndBuildContext/answerLLM events route.ts already knows how to read.
export const agenticChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        route: routeChain,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    RunnableBranch.from([
        [({ route }: { route: Route }) => route === "DIRECT", directChain],
        [({ route }: { route: Route }) => route === "MULTI", multiQueryChain(filter)],
        naiveChain(filter),
    ]),
]);
