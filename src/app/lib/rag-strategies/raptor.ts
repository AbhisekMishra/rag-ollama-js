import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate } from "../prompts";
import { llm } from "../ollama";
import { raptorRetrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// RAPTOR: retrieves on the raw question (isolating the change against `naive`) but against a
// hierarchical summary tree built at ingestion — so a broad question ("what is this paper about?")
// can match a section-level summary that no single verbatim chunk could satisfy, while a narrow
// one still matches a leaf. Requires supabaseScripts.txt STEP 13 and a re-upload of the document.
export const raptorChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        retrieved: RunnableSequence.from([
            ({ question }) => question,
            raptorRetrieveAndBuildContext(filter)
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
