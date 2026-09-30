// Shared between scripts/langfuse-sync.ts (which creates the LangFuse dataset) and runEval.ts
// (which links each eval trace to its dataset item as a "dataset run"). Item ids are
// deterministic by golden-set index so re-syncing upserts instead of duplicating.
export const GOLDEN_DATASET_NAME = "rag-golden-set";

export function goldenItemId(index: number): string {
    return `golden-${index}`;
}
