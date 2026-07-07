import { PromptTemplate } from "@langchain/core/prompts";

export const standaloneTemplate = PromptTemplate.fromTemplate(
    `Given some conversation history and a question, convert the question to a standalone question. 
    conversation history: {history}
    question: {question} 
    standalone question:`
);

export const answerTemplate = PromptTemplate.fromTemplate(`You are a helpful and enthusiastic support bot who answers questions based on the provided context.
The context is a list of numbered excerpts, each labeled "[Source N | Page P]" followed by its text.
Your goal is to find the most relevant information from the context to answer the question.

- Cite the excerpts you relied on inline, right after the relevant sentence, using their bracket label exactly as given, e.g. "[Source 2]".
- If you don't know the answer or cannot find it in the context, say, "I don't know," and do not fabricate an answer or a citation.
- Always respond in a friendly and conversational tone.

Context:
{context}

Question:
{question}

Answer:`);