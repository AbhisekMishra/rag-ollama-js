import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate } from "../prompts";
import { llm } from "../ollama";
import { graphRetrieveAndBuildContext } from "./retrieval";
import type { RagStrategy } from "./types";

const answerLLM = llm.withConfig({ runName: "answerLLM" });

const answerChain = RunnableSequence.from([
    answerTemplate,
    answerLLM,
    new StringOutputParser()
]);

// Graph RAG: retrieves on the raw question (isolating the change against `naive`) via
// graphRetrieveAndBuildContext(filter) (retrieval.ts), which extracts entities mentioned in the
// question and traverses the entity/relation graph built at ingestion time (see graph-rag.ts and
// supabaseScripts.txt STEP 12) instead of a vector similarity search — falling back to plain
// vector retrieval when no entities matched at all.
export const graphChain: RagStrategy = (filter) => RunnableSequence.from([
    {
        retrieved: RunnableSequence.from([
            ({ question }) => question,
            graphRetrieveAndBuildContext(filter)
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
