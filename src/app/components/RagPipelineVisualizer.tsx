import { RAG_PIPELINE_STAGES, type PipelineStageKind } from "@/app/lib/rag-strategies/pipeline-metadata";
import type { RagMode } from "@/app/lib/rag-strategies/modes";

export interface LiveStageState {
    status: "active" | "done";
    data?: unknown;
}

interface DocSummary {
    count: number;
    chunks: { snippet: string; pageNumber: number }[];
}

interface CandidateCount {
    count: number;
}

interface ScoredCandidate {
    snippet: string;
    pageNumber: number;
    score: number;
    kept: boolean;
    prompt: string;
    completion: string;
}

interface ScoreTable {
    table: ScoredCandidate[];
}

interface CompressedChunk {
    pageNumber: number;
    original: string;
    compressed: string;
    reduced: boolean;
    prompt: string;
    completion: string;
}

interface CompressionTable {
    table: CompressedChunk[];
}

interface LlmIO {
    prompt: string;
    completion: string;
}

// What the backend sends per stage on its "end" event: the raw input that flowed into the
// stage, its shaped output, and — for the LLM-driven stages — the literal rendered prompt and
// completion, so a newbie can see exactly what was sent to the model or the vector DB.
interface StagePayload {
    input?: unknown;
    output?: unknown;
    llm?: LlmIO;
}

function isStagePayload(data: unknown): data is StagePayload {
    return typeof data === "object" && data !== null && ("input" in data || "output" in data || "llm" in data);
}

function isDocSummary(data: unknown): data is DocSummary {
    return typeof data === "object" && data !== null && "chunks" in data;
}

function isScoreTable(data: unknown): data is ScoreTable {
    return typeof data === "object" && data !== null && "table" in data;
}

function isCompressionTable(data: unknown): data is CompressionTable {
    return typeof data === "object" && data !== null && "table" in data;
}

// Generic per-item breakdown (speculative drafts, FLARE sentence checks): a `rows` array of
// {title, badge, highlight, details[]} — mirrors StageRow in rag-strategies/retrieval.ts.
interface StageRowData {
    title: string;
    badge: string;
    highlight: boolean;
    details: { label: string; text: string }[];
}

function isRowTable(data: unknown): data is { rows: StageRowData[] } {
    return typeof data === "object" && data !== null && "rows" in data && Array.isArray((data as { rows: unknown }).rows);
}

function isCandidateCount(data: unknown): data is CandidateCount {
    return typeof data === "object" && data !== null && "count" in data;
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
            <path d="M5 12.5 9.5 17 19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function InfoIcon({ className = "h-3 w-3" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 11v5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="7.75" r="1" fill="currentColor" />
        </svg>
    );
}

function StageDots() {
    return (
        <span className="flex items-center gap-1">
            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-accent" />
        </span>
    );
}

// What actually went INTO the stage — the literal query text/list sent to the vector DB, or
// the {question, history} a query-transformation stage started from.
function StageInput({ kind, input }: { kind: PipelineStageKind; input: unknown }) {
    if (input === undefined || input === null || input === "") return null;
    const label = kind === "retrieve" ? "Sent to vector DB" : "Input";

    if (Array.isArray(input)) {
        return (
            <div className="mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-ink-soft">
                    {input.map((item, index) => <li key={index}>{String(item)}</li>)}
                </ul>
            </div>
        );
    }

    return (
        <div className="mt-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
            <p className="rounded-lg border border-border bg-paper px-2.5 py-1.5 text-xs italic text-ink-soft">&ldquo;{String(input)}&rdquo;</p>
        </div>
    );
}

// The literal prompt sent to Ollama and the literal completion it returned — collapsed by
// default since the rendered prompt includes the full template boilerplate, not just the
// interesting part, but this is the ground truth of "what did the LLM actually see and say".
function StageLlmIO({ llm }: { llm: LlmIO }) {
    return (
        <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer select-none text-ink-faint hover:text-accent">Show raw LLM prompt &amp; response</summary>
            <div className="mt-1 space-y-1.5">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Prompt</p>
                    <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-paper px-2.5 py-1.5 font-mono text-[11px] text-ink-soft">{llm.prompt}</pre>
                </div>
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Response</p>
                    <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-paper px-2.5 py-1.5 font-mono text-[11px] text-ink-soft">{llm.completion}</pre>
                </div>
            </div>
        </details>
    );
}

// A small eyebrow label above the output block, mirroring StageInput's "Sent to vector DB" —
// without it a bare row of chunk pills reads as decoration rather than "this is what came back".
function OutputLabel({ kind }: { kind: PipelineStageKind }) {
    const label = kind === "retrieve" ? "Received from vector DB" : "Result";
    return <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>;
}

// Renders whatever real, request-specific data a stage produced — the standalone question it
// rewrote to, the phrasings it generated, the chunks it retrieved, or the full rerank score
// table (kept vs. dropped) — so the pipeline isn't just a progress bar but shows its work.
function StageOutput({ id, kind, output }: { id: string; kind: PipelineStageKind; output: unknown }) {
    if (output === undefined || output === null) return null;

    if ((id === "standaloneQuestion" || id === "hydeDraft" || id === "flareDraft") && typeof output === "string") {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <p className="rounded-lg border border-border bg-paper px-2.5 py-1.5 text-xs italic text-ink-soft">
                    &ldquo;{output}&rdquo;
                </p>
            </div>
        );
    }

    if (id === "generatePhrasings" && Array.isArray(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-xs text-ink-soft">
                    {output.map((phrasing, index) => <li key={index}>{String(phrasing)}</li>)}
                </ol>
            </div>
        );
    }

    if (id === "scoreCandidates" && isScoreTable(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <div className="mt-0.5 max-h-64 space-y-1 overflow-y-auto pr-1">
                    {output.table.map((row, index) => (
                        <details
                            key={index}
                            className={`rounded-lg border text-[11px] ${
                                row.kept ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink-faint"
                            }`}
                        >
                            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-2 py-1">
                                <span className="truncate">Page {row.pageNumber} — {row.snippet.slice(0, 50)}…</span>
                                <span className="shrink-0 font-mono">{row.score.toFixed(2)}</span>
                            </summary>
                            <div className="space-y-1.5 border-t border-border px-2 py-1.5">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">Prompt sent to LLM</p>
                                    <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{row.prompt}</pre>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">LLM response</p>
                                    <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{row.completion}</pre>
                                </div>
                            </div>
                        </details>
                    ))}
                </div>
            </div>
        );
    }

    if (id === "compressChunks" && isCompressionTable(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <div className="mt-0.5 max-h-64 space-y-1 overflow-y-auto pr-1">
                    {output.table.map((row, index) => (
                        <details
                            key={index}
                            className={`rounded-lg border text-[11px] ${
                                row.reduced ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink-faint"
                            }`}
                        >
                            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-2 py-1">
                                <span>Page {row.pageNumber}</span>
                                <span className="shrink-0">{row.reduced ? "trimmed" : "kept as-is"}</span>
                            </summary>
                            <div className="space-y-1.5 border-t border-border px-2 py-1.5">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">Original chunk</p>
                                    <p className="mt-0.5 rounded border border-border bg-paper px-2 py-1 text-ink-soft">{row.original}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">After compression</p>
                                    <p className="mt-0.5 rounded border border-border bg-paper px-2 py-1 text-ink-soft">{row.compressed || "(nothing kept — fell back to original)"}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">Prompt sent to LLM</p>
                                    <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{row.prompt}</pre>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide">LLM response</p>
                                    <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{row.completion}</pre>
                                </div>
                            </div>
                        </details>
                    ))}
                </div>
            </div>
        );
    }

    if (isRowTable(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <div className="mt-0.5 max-h-64 space-y-1 overflow-y-auto pr-1">
                    {output.rows.map((row, index) => (
                        <details
                            key={index}
                            className={`rounded-lg border text-[11px] ${
                                row.highlight ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink-faint"
                            }`}
                        >
                            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-2 py-1">
                                <span className="truncate">{row.title}</span>
                                <span className="shrink-0 font-mono">{row.badge}</span>
                            </summary>
                            <div className="space-y-1.5 border-t border-border px-2 py-1.5">
                                {row.details.map((detail, i) => (
                                    <div key={i}>
                                        <p className="text-[10px] font-semibold uppercase tracking-wide">{detail.label}</p>
                                        <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{detail.text}</pre>
                                    </div>
                                ))}
                            </div>
                        </details>
                    ))}
                </div>
            </div>
        );
    }

    if (isDocSummary(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                        {output.count} chunk{output.count === 1 ? "" : "s"}
                    </span>
                    {output.chunks.slice(0, 6).map((chunk, index) => (
                        <span key={index} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                            Page {chunk.pageNumber}
                        </span>
                    ))}
                </div>
            </div>
        );
    }

    if (isCandidateCount(output)) {
        return (
            <div className="mt-1.5">
                <OutputLabel kind={kind} />
                <p className="text-xs text-ink-soft">{output.count} candidates fetched</p>
            </div>
        );
    }

    return null;
}

function StageData({ id, kind, data }: { id: string; kind: PipelineStageKind; data: unknown }) {
    if (!isStagePayload(data)) return null;
    return (
        <>
            <StageInput kind={kind} input={data.input} />
            {data.llm && <StageLlmIO llm={data.llm} />}
            <StageOutput id={id} kind={kind} output={data.output} />
        </>
    );
}

// Vertical stepper over a mode's pipeline stages — reused both as a persistent "watch this mode
// run" panel (liveStages updates in real time from streamed SSE stage events) and as a frozen
// per-message "how was this answer generated?" trace. `liveStages: null` renders every stage as
// pending, so mode selection alone is already a browsable teaching view before any question is sent.
export function RagPipelineVisualizer({ mode, liveStages }: { mode: RagMode; liveStages: Record<string, LiveStageState> | null }) {
    const stages = RAG_PIPELINE_STAGES[mode];

    return (
        <ol>
            {stages.map((stage, index) => {
                const state = liveStages?.[stage.id];
                const status = state?.status ?? "pending";
                const isLast = index === stages.length - 1;

                return (
                    <li key={stage.id} className={`relative pl-8 ${isLast ? "" : "pb-4"}`}>
                        {!isLast && (
                            <span className={`absolute left-[11px] top-6 h-full w-px ${status === "done" ? "bg-accent" : "bg-border"}`} />
                        )}
                        <span
                            className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border ${
                                status === "pending" ? "border-border bg-surface text-ink-soft" : "border-accent bg-accent-soft text-accent"
                            }`}
                        >
                            {status === "active" ? <StageDots /> : status === "done" ? <CheckIcon /> : (
                                <span className="text-[10px] font-semibold">{index + 1}</span>
                            )}
                        </span>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{stage.label}</p>
                        <p className="text-xs text-ink-soft">{stage.what}</p>
                        <details className="mt-1 text-xs">
                            <summary className="cursor-pointer select-none text-ink-faint hover:text-accent">Why this step?</summary>
                            <p className="mt-1 text-ink-soft">{stage.why}</p>
                        </details>
                        <StageData id={stage.id} kind={stage.kind} data={state?.data} />
                    </li>
                );
            })}
        </ol>
    );
}
