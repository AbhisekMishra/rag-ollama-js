import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, groundednessTemplate } from "../prompts";
import { llm } from "../ollama";
import { selfRagRetrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

const groundednessChain = RunnableSequence.from([
    groundednessTemplate,
    llm,
    new StringOutputParser(),
]);

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

interface GroundednessResult {
    score: number;
    prompt: string;
    completion: string;
}

// Same bare-.invoke() pattern as retrieval.ts's judgeSufficiency/scoreRelevance — this runs once,
// after the single streamed answerLLM call, purely as a reported score. It does NOT gate a
// regenerate: doing that would require a second answerLLM call, which would break the SSE
// protocol's assumption of exactly one clean token stream per response (see retrieval.ts's
// selfRagRetrieve comment for the retrieval-side half of "capped hops", which is where the
// actual retry loop lives instead).
async function critiqueGroundedness(context: string, answer: string): Promise<{ answer: string; groundedness: GroundednessResult }> {
    const prompt = await groundednessTemplate.format({ context, answer });
    const completion = await groundednessChain.invoke({ context, answer });
    return { answer, groundedness: { score: clamp01(parseFloat(completion)), prompt, completion } };
}

// Self-RAG: judges whether retrieved context is sufficient before generating (capped-hop
// rewrite+retry if not — see retrieval.ts's selfRagRetrieve), then after the single streamed
// answer, critiques its own groundedness against that context as an informational score.
export const selfRagChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        retrieved: RunnableSequence.from([
            ({ question }) => question,
            selfRagRetrieveAndBuildContext(filter)
        ]),
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        context: ({ retrieved }) => retrieved.context,
        question: ({ question }) => question,
        history: ({ history }) => history,
    },
    {
        answer: answerChain,
        question: ({ question }) => question,
        context: ({ context }) => context,
    },
    RunnableLambda.from(({ answer, context }: { answer: string; question: string; context: string }) =>
        critiqueGroundedness(context, answer)
    ).withConfig({ runName: "critiqueGroundedness" }),
]);
