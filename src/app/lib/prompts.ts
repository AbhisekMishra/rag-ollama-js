import { PromptTemplate } from "@langchain/core/prompts";

export const standaloneTemplate = PromptTemplate.fromTemplate(
    `Given some conversation history and a question, convert the question to a standalone question. 
    conversation history: {history}
    question: {question} 
    standalone question:`
);

export const multiQueryTemplate = PromptTemplate.fromTemplate(
    `You are helping retrieve documents from a vector database. Generate 4 alternative phrasings of the user's question, each capturing the same intent from a different angle (different vocabulary, specificity, or perspective). Use the conversation history to resolve pronouns and references so every phrasing stands alone.
    Write one phrasing per line. No numbering, no bullets, no commentary — just the 4 lines.
    conversation history: {history}
    question: {question}
    alternative phrasings:`
);

export const hydeTemplate = PromptTemplate.fromTemplate(
    `Write a short passage (2-4 sentences) that plausibly answers the question below, as if excerpted from a reference document on the topic. Use the conversation history to resolve pronouns and references. Write in a confident, factual, document-like style — do not hedge, do not say "it depends", do not address the reader. It does not matter whether the facts are correct; only the wording and style matter.
    conversation history: {history}
    question: {question}
    passage:`
);

export const rerankTemplate = PromptTemplate.fromTemplate(
    `On a scale from 0.0 to 1.0, how relevant is the following passage to answering the question? Judge relevance only — ignore writing quality or completeness.
    Reply with ONLY a number between 0 and 1, nothing else.
    question: {question}
    passage: {passage}
    relevance score:`
);

export const compressionTemplate = PromptTemplate.fromTemplate(
    `Given a question and a passage, remove every sentence from the passage that is NOT relevant to answering the question. Keep the relevant sentences exactly as written — do not paraphrase, summarize, reorder, or add anything of your own. If no sentence is relevant, reply with an empty string.
    question: {question}
    passage: {passage}
    relevant sentences only:`
);

export const contextSufficiencyTemplate = PromptTemplate.fromTemplate(
    `On a scale from 0.0 to 1.0, how sufficient is the following retrieved context to fully answer the question? Judge whether the information needed is present at all, not writing quality.
    Reply with ONLY a number between 0 and 1, nothing else.
    question: {question}
    context: {context}
    sufficiency score:`
);

export const selfRagRewriteTemplate = PromptTemplate.fromTemplate(
    `The following retrieved context was judged insufficient to answer the question below. Rewrite the question using different terms or a different angle so a search is more likely to find the missing information. Reply with ONLY the rewritten question, nothing else.
    question: {question}
    insufficient context: {context}
    rewritten question:`
);

export const cragRewriteTemplate = PromptTemplate.fromTemplate(
    `The following passages were retrieved for the question below, but none were relevant enough. Rewrite the question using different terms so a search is more likely to find relevant passages. Reply with ONLY the rewritten question, nothing else.
    question: {question}
    low-relevance passages: {passages}
    rewritten question:`
);

export const groundednessTemplate = PromptTemplate.fromTemplate(
    `On a scale from 0.0 to 1.0, how well is the following answer supported by the given context? A grounded answer only states things the context actually backs up. Judge support only, not writing quality.
    Reply with ONLY a number between 0 and 1, nothing else.
    context: {context}
    answer: {answer}
    groundedness score:`
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