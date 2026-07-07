export interface RetrievedSource {
    id: number;
    pageNumber: number;
}

interface RetrievedDoc {
    pageContent: string;
    metadata?: {
        pageNumber?: number;
    };
}

// Numbers each retrieved chunk as "Source N" in the prompt context (so the LLM can cite it
// inline) and returns the matching {id, pageNumber} list the client uses to jump the embedded
// PDF viewer to the right page — the one place chunk metadata survives past retrieval.
export function buildContext(retrievedDocs: RetrievedDoc[]): { context: string; sources: RetrievedSource[] } {
    const context = retrievedDocs
        .map((doc, index) => `[Source ${index + 1} | Page ${doc.metadata?.pageNumber ?? 0}]\n${doc.pageContent}`)
        .join("\n\n");

    const sources = retrievedDocs.map((doc, index) => ({
        id: index + 1,
        pageNumber: doc.metadata?.pageNumber ?? 0,
    }));

    return { context, sources };
}
