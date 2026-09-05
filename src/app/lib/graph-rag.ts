import { llm } from "./ollama";
import { graphExtractionTemplate, questionEntitiesTemplate } from "./prompts";
import { supabaseClient, retriever } from "./supabase";

interface ExtractedTriple {
    source: string;
    relation: string;
    target: string;
}

interface ChunkExtraction {
    entities: string[];
    relations: ExtractedTriple[];
}

function completionText(content: unknown): string {
    return typeof content === "string" ? content : JSON.stringify(content);
}

// Small local models are unreliable at strict JSON, so this is a best-effort parse: grab the
// first {...} object in the completion and skip anything that doesn't shape up. A chunk that
// fails to parse is simply skipped — same category of simplification as sentence-window's
// regex sentence splitter (documented, not production-grade NLP).
function parseExtraction(raw: string): ChunkExtraction {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { entities: [], relations: [] };
    try {
        const parsed = JSON.parse(match[0]);
        const entities = Array.isArray(parsed.entities)
            ? parsed.entities.filter((e: unknown): e is string => typeof e === "string")
            : [];
        const relations = Array.isArray(parsed.relations)
            ? parsed.relations.filter((r: unknown): r is ExtractedTriple =>
                !!r && typeof r === "object"
                && typeof (r as ExtractedTriple).source === "string"
                && typeof (r as ExtractedTriple).relation === "string"
                && typeof (r as ExtractedTriple).target === "string")
            : [];
        return { entities, relations };
    } catch {
        return { entities: [], relations: [] };
    }
}

async function extractFromChunk(chunkText: string): Promise<ChunkExtraction> {
    const prompt = await graphExtractionTemplate.format({ passage: chunkText });
    const completion = await llm.invoke(prompt);
    return parseExtraction(completionText(completion.content));
}

export interface GraphInsertPlan {
    entityNames: string[];
    entityTypes: Map<string, string | null>;
    mentionsByEntity: Map<string, number[]>;
    relations: { sourceName: string; targetName: string; label: string }[];
}

// One LLM call per parent chunk asking for a small JSON list of entity mentions and (source,
// relation, target) triples. Entity names are normalized (trimmed, lowercased) and deduped
// globally across the document, so the same entity mentioned in several chunks becomes one
// graph_entities row backed by multiple graph_entity_mentions rows.
export async function extractGraphData(chunks: { id: number; text: string }[]): Promise<GraphInsertPlan> {
    const perChunk = await Promise.all(chunks.map((chunk) => extractFromChunk(chunk.text)));

    const entityTypes = new Map<string, string | null>();
    const mentionsByEntity = new Map<string, number[]>();
    const relations: { sourceName: string; targetName: string; label: string }[] = [];

    perChunk.forEach((extraction, i) => {
        const chunkId = chunks[i].id;
        for (const rawName of extraction.entities) {
            const name = rawName.trim().toLowerCase();
            if (!name) continue;
            if (!entityTypes.has(name)) entityTypes.set(name, null);
            const mentions = mentionsByEntity.get(name) ?? [];
            if (!mentions.includes(chunkId)) mentions.push(chunkId);
            mentionsByEntity.set(name, mentions);
        }
        for (const triple of extraction.relations) {
            const sourceName = triple.source.trim().toLowerCase();
            const targetName = triple.target.trim().toLowerCase();
            if (!sourceName || !targetName) continue;
            relations.push({ sourceName, targetName, label: triple.relation.trim() });
            // A relation implies its endpoints are entities too, even if the entity list missed them.
            if (!mentionsByEntity.has(sourceName)) mentionsByEntity.set(sourceName, [chunkId]);
            if (!mentionsByEntity.has(targetName)) mentionsByEntity.set(targetName, [chunkId]);
        }
    });

    return { entityNames: Array.from(mentionsByEntity.keys()), entityTypes, mentionsByEntity, relations };
}

// Inserts the extracted plan: entities first (so their DB-assigned ids are known), then the
// mentions and relations that reference those ids by name lookup.
export async function insertGraphData(plan: GraphInsertPlan, userId: string): Promise<void> {
    if (plan.entityNames.length === 0) return;

    const entityRows = plan.entityNames.map((name) => ({
        name,
        type: plan.entityTypes.get(name) ?? null,
        user_id: userId,
    }));
    const { data: insertedEntities, error: entityError } = await supabaseClient
        .from("graph_entities")
        .insert(entityRows)
        .select("id, name");
    if (entityError) throw new Error(`graph_entities insert failed: ${entityError.message}`);

    const idByName = new Map((insertedEntities ?? []).map((row) => [row.name as string, row.id as number]));

    const mentionRows = Array.from(plan.mentionsByEntity.entries()).flatMap(([name, chunkIds]) => {
        const entityId = idByName.get(name);
        if (entityId === undefined) return [];
        return chunkIds.map((chunkId) => ({ entity_id: entityId, chunk_id: chunkId }));
    });
    if (mentionRows.length > 0) {
        const { error: mentionError } = await supabaseClient.from("graph_entity_mentions").insert(mentionRows);
        if (mentionError) throw new Error(`graph_entity_mentions insert failed: ${mentionError.message}`);
    }

    const relationRows = plan.relations.flatMap((relation) => {
        const sourceEntityId = idByName.get(relation.sourceName);
        const targetEntityId = idByName.get(relation.targetName);
        if (sourceEntityId === undefined || targetEntityId === undefined) return [];
        return [{ source_entity_id: sourceEntityId, target_entity_id: targetEntityId, label: relation.label, user_id: userId }];
    });
    if (relationRows.length > 0) {
        const { error: relationError } = await supabaseClient.from("graph_relations").insert(relationRows);
        if (relationError) throw new Error(`graph_relations insert failed: ${relationError.message}`);
    }
}

function parseEntityList(raw: string): string[] {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((e): e is string => typeof e === "string")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
    } catch {
        return [];
    }
}

async function extractQuestionEntities(question: string): Promise<string[]> {
    const prompt = await questionEntitiesTemplate.format({ question });
    const completion = await llm.invoke(prompt);
    return parseEntityList(completionText(completion.content));
}

interface DocRow {
    id: number;
    content: string;
    metadata: Record<string, unknown>;
}

// 1-hop graph traversal: look up entities mentioned in the question, expand to their directly
// related entities via graph_relations, then pull every chunk that mentions any of those
// entities back out of `documents` by id. Name/exact match only (no embedding-based entity
// matching) and 1-hop only (no multi-hop traversal) — both documented simplifications, same
// spirit as hybrid search's "not real BM25" note.
async function traverseGraph(userId: string, entityNames: string[]): Promise<DocRow[]> {
    if (entityNames.length === 0) return [];

    const { data: matchedEntities, error: entityError } = await supabaseClient
        .from("graph_entities")
        .select("id, name")
        .eq("user_id", userId)
        .in("name", entityNames);
    if (entityError) throw new Error(`graph_entities lookup failed: ${entityError.message}`);
    if (!matchedEntities || matchedEntities.length === 0) return [];

    const matchedIds = matchedEntities.map((row) => row.id as number);

    const { data: relations, error: relationError } = await supabaseClient
        .from("graph_relations")
        .select("source_entity_id, target_entity_id")
        .eq("user_id", userId)
        .or(`source_entity_id.in.(${matchedIds.join(",")}),target_entity_id.in.(${matchedIds.join(",")})`);
    if (relationError) throw new Error(`graph_relations lookup failed: ${relationError.message}`);

    const allEntityIds = new Set<number>(matchedIds);
    for (const relation of relations ?? []) {
        allEntityIds.add(relation.source_entity_id as number);
        allEntityIds.add(relation.target_entity_id as number);
    }

    const { data: mentions, error: mentionError } = await supabaseClient
        .from("graph_entity_mentions")
        .select("chunk_id")
        .in("entity_id", Array.from(allEntityIds));
    if (mentionError) throw new Error(`graph_entity_mentions lookup failed: ${mentionError.message}`);

    const chunkIds = Array.from(new Set((mentions ?? []).map((row) => row.chunk_id as number)));
    if (chunkIds.length === 0) return [];

    const { data: rows, error: docsError } = await supabaseClient
        .from("documents")
        .select("id, content, metadata")
        .in("id", chunkIds);
    if (docsError) throw new Error(`documents lookup failed: ${docsError.message}`);
    return (rows ?? []) as DocRow[];
}

// Graph retrieval: extracts entities mentioned in the question, traverses one hop of the graph
// built at ingestion time, and pulls the mentioned chunks. Falls back to plain vector retrieval
// on the raw question when no entities matched at all, so a question with no recognizable
// proper nouns doesn't hit a dead-end empty context.
export const graphSearcher = (filter: Record<string, unknown>) => async (query: string) => {
    const userId = (filter.userId as string | undefined) ?? "";
    const entityNames = await extractQuestionEntities(query);
    const rows = await traverseGraph(userId, entityNames);
    if (rows.length > 0) {
        return rows.map((row) => ({ pageContent: row.content, metadata: row.metadata }));
    }
    return retriever(filter).invoke(query);
};
