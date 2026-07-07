import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";

import { retriever } from "../supabase";
import { buildContext } from "../../utils/helpers";

// Retrieval piped into citation-context building — composed, not hand-orchestrated with
// async/await — as one named runnable step shared by every strategy, so the chat route can
// read its `sources` output via `.streamEvents()` as soon as it finishes, ahead of the answer
// tokens that follow later in the same chain.
export const retrieveAndBuildContext = (filter: Record<string, unknown>) => RunnableSequence.from([
    retriever(filter),
    RunnableLambda.from(buildContext),
]).withConfig({ runName: "retrieveAndBuildContext" });
