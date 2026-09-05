import { RunnableSequence, RunnableBranch, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { directAnswerTemplate, routeComplexityTemplate } from "../prompts";
import { llm } from "../ollama";
import { naiveChain } from "./naive";
import { multiHopChain } from "./multi-hop";
import type { RagStrategy } from "./types";

type Complexity = "DIRECT" | "SIMPLE" | "COMPOUND";

function parseComplexity(raw: string): Complexity {
    const cleaned = raw.trim().toUpperCase();
    if (cleaned.includes("DIRECT")) return "DIRECT";
    if (cleaned.includes("COMPOUND")) return "COMPOUND";
    return "SIMPLE";
}

// Named distinctly from the outer routeChain's own "routeComplexity" runName so the chat route
// can capture the literal rendered prompt/completion for this LLM call (see LLM_STAGE_RUNNAMES
// in route.ts).
const routeLLM = llm.withConfig({ runName: "routeComplexityLLM" });

const routeChain = RunnableSequence.from([
    routeComplexityTemplate,
    routeLLM,
    new StringOutputParser(),
    RunnableLambda.from(parseComplexity),
]).withConfig({ runName: "routeComplexity" });

const answerLLM = llm.withConfig({ runName: "answerLLM" });

// Widened to the bare `RunnableSequence` type (same convention `RagStrategy` uses, see
// agentic.ts's directChain for the same fix) rather than the strict template-inferred input
// type — RunnableBranch requires every branch to share one input type.
const directChain: RunnableSequence = RunnableSequence.from([
    directAnswerTemplate,
    answerLLM,
    new StringOutputParser(),
]);

// Adaptive RAG (capstone): built on top of the two prior modules it routes between rather than
// reinventing retrieval logic — reuses `naiveChain` for SIMPLE questions and `multiHopChain` for
// COMPOUND ones, plus a DIRECT no-retrieval branch, via the same RunnableBranch pattern
// `agentic.ts` uses. Kept as its own small file rather than merged with `agentic.ts` into one
// parameterized router — the two routers classify by a genuinely different axis (complexity
// here vs. mechanism there) even though the branch-dispatch plumbing looks similar.
export const adaptiveChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        route: routeChain,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    RunnableBranch.from([
        [({ route }: { route: Complexity }) => route === "DIRECT", directChain],
        [({ route }: { route: Complexity }) => route === "COMPOUND", multiHopChain(filter)],
        naiveChain(filter),
    ]),
]);
