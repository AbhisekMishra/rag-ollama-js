import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { answerTemplate, standaloneTemplate } from "./prompts";
import { llm } from "./ollama";
import { retriever } from "./supabase";
import { combineDocuments } from "../utils/helpers";

const promptChain = RunnableSequence.from([
    standaloneTemplate,
    llm,
    new StringOutputParser()
])

const retrieverChain = (filter: Record<string, unknown>) => RunnableSequence.from([
    result => result.standaloneQuestion,
    retriever(filter),
    combineDocuments
])

const answerChain = RunnableSequence.from([
    answerTemplate,
    llm,
    new StringOutputParser()
])

export const outputChain = (filter: Record<string, unknown>) => RunnableSequence.from([
    {
        standaloneQuestion: promptChain,
        originalQuestion: new RunnablePassthrough()
    },
    {
        context: retrieverChain(filter),
        question: ({ originalQuestion }) => originalQuestion.question,
        history: ({ originalQuestion }) => originalQuestion.history,
    },
    answerChain
])
