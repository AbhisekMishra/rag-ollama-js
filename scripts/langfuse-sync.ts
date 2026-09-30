import { PromptTemplate } from "@langchain/core/prompts";

import * as prompts from "../src/app/lib/prompts";
import { GOLDEN_SET, EVAL_DOCUMENT } from "../src/app/lib/eval/goldenSet";
import { GOLDEN_DATASET_NAME, goldenItemId } from "../src/app/lib/eval/dataset";
import { langfuseFetch } from "../src/app/lib/eval/langfuseApi";
import { env } from "../src/app/utils/env";

// exportName -> "export-name" (LangFuse prompt names are conventionally kebab-case)
function toPromptName(exportName: string): string {
    return exportName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// LangChain templates use {var}; LangFuse text prompts use {{var}}.
function toLangfuseTemplate(template: string): string {
    return template.replace(/(?<!\{)\{(\w+)\}(?!\})/g, "{{$1}}");
}

async function main() {
    if (!env.langfuse.publicKey) {
        console.error("LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY not set — nothing to sync.");
        process.exit(1);
    }

    // Dataset + items. Item ids are deterministic (goldenItemId) so re-running upserts instead
    // of duplicating, and eval runs can link traces back to the same items.
    await langfuseFetch("/api/public/v2/datasets", {
        name: GOLDEN_DATASET_NAME,
        description: `Golden question set for "${EVAL_DOCUMENT}" used by npm run eval.`,
    });
    for (const [i, golden] of GOLDEN_SET.entries()) {
        await langfuseFetch("/api/public/dataset-items", {
            id: goldenItemId(i),
            datasetName: GOLDEN_DATASET_NAME,
            input: { question: golden.question },
            expectedOutput: golden.groundTruth,
        });
    }
    console.log(`Synced dataset "${GOLDEN_DATASET_NAME}" (${GOLDEN_SET.length} items).`);

    // Prompts. Each sync creates a new version only if the content changed (LangFuse dedupes
    // identical text), tagged "production" so it's the version a fetch-by-label would resolve.
    let count = 0;
    for (const [exportName, value] of Object.entries(prompts)) {
        if (!(value instanceof PromptTemplate)) continue;
        await langfuseFetch("/api/public/v2/prompts", {
            name: toPromptName(exportName),
            type: "text",
            prompt: toLangfuseTemplate(String(value.template)),
            labels: ["production"],
        });
        count++;
    }
    console.log(`Synced ${count} prompts.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
