import { CHUNK_INDEXES, type ChunkIndex } from "@/app/lib/chunk-index";
import { CHUNK_STRATEGY_META } from "@/app/lib/chunk-strategy-meta";
import { Spinner } from "@/app/components/Spinner";

export interface ChunkRow {
    id: number;
    content: string;
    metadata: Record<string, unknown>;
}

const INDEX_LABELS: Record<ChunkIndex, string> = {
    documents: "Naive",
    sentence_documents: "Sentence-Window",
    child_documents: "Parent-Document",
    raptor_documents: "RAPTOR",
};

function pageOf(metadata: Record<string, unknown>): string {
    const page = metadata.pageNumber;
    return typeof page === "number" ? String(page) : "—";
}

// One expandable row per stored chunk — summary is always visible, full content/metadata sits
// behind the disclosure so a long document's chunk list stays scannable at a glance.
function ChunkRowItem({ chunk, selectedIndex, onJumpToPage }: { chunk: ChunkRow; selectedIndex: ChunkIndex; onJumpToPage?: (page: number) => void }) {
    const windowText = chunk.metadata.windowText;
    const parentText = chunk.metadata.parentText;
    const pageNumber = chunk.metadata.pageNumber;

    return (
        <details className="rounded-lg border border-border bg-surface text-[11px] text-ink-soft">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-2 py-1">
                {onJumpToPage && typeof pageNumber === "number" ? (
                    <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJumpToPage(pageNumber); }}
                        className="shrink-0 rounded-full border border-border bg-paper px-1.5 py-0.5 font-medium text-ink-faint transition-colors hover:border-accent hover:text-accent"
                    >
                        Page {pageOf(chunk.metadata)}
                    </button>
                ) : (
                    <span className="shrink-0 rounded-full border border-border bg-paper px-1.5 py-0.5 font-medium text-ink-faint">
                        Page {pageOf(chunk.metadata)}
                    </span>
                )}
                <span className="truncate">{chunk.content.slice(0, 80)}{chunk.content.length > 80 ? "…" : ""}</span>
            </summary>
            <div className="space-y-1.5 border-t border-border px-2 py-1.5">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Content</p>
                    <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{chunk.content}</pre>
                </div>
                {selectedIndex === "sentence_documents" && typeof windowText === "string" && (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Expanded window (±2 sentences)</p>
                        <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{windowText}</pre>
                    </div>
                )}
                {selectedIndex === "child_documents" && typeof parentText === "string" && (
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Parent chunk</p>
                        <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{parentText}</pre>
                    </div>
                )}
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Metadata</p>
                    <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-paper px-2 py-1 font-mono text-[10px] text-ink-soft">{JSON.stringify(chunk.metadata, null, 2)}</pre>
                </div>
            </div>
        </details>
    );
}

interface ChunkViewerProps {
    selectedIndex: ChunkIndex;
    onSelectIndex: (index: ChunkIndex) => void;
    onJumpToPage?: (page: number) => void;
    chunks: ChunkRow[] | null;
    loading: boolean;
    error: string | null;
}

// Browses the raw rows Supabase actually stored for the current document across its three
// chunk indexes — a teaching-aid counterpart to RagPipelineVisualizer's "how retrieval works",
// this is "here's exactly what ingestion produced".
export function ChunkViewer({ selectedIndex, onSelectIndex, onJumpToPage, chunks, loading, error }: ChunkViewerProps) {
    const meta = CHUNK_STRATEGY_META[selectedIndex];

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
            <select
                className="w-full rounded-lg border border-border bg-paper px-2.5 py-1.5 font-mono text-xs text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                value={selectedIndex}
                onChange={(e) => onSelectIndex(e.target.value as ChunkIndex)}
            >
                {CHUNK_INDEXES.map((index) => (
                    <option key={index} value={index}>{INDEX_LABELS[index]}</option>
                ))}
            </select>

            <div className="rounded-lg border border-border bg-paper px-3 py-2 text-xs text-ink-soft">
                <p className="font-semibold text-ink">{meta.label}</p>
                <p className="mt-1">{meta.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {meta.config.map((entry) => (
                        <span key={entry.label}>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{entry.label}: </span>
                            <span className="font-mono text-[11px]">{entry.value}</span>
                        </span>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Spinner className="h-6 w-6 text-ink-faint" />
                </div>
            ) : error ? (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-ink-soft">
                    <p>Failed to load chunks: {error}</p>
                </div>
            ) : chunks === null ? null : chunks.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center text-xs text-ink-soft">
                    <p>No chunks in this index yet.</p>
                    {selectedIndex !== "documents" && (
                        <p className="text-ink-faint">This document may have been uploaded before this strategy&apos;s index existed — try re-uploading (Replace) to backfill it.</p>
                    )}
                </div>
            ) : (
                <>
                    <span className="w-fit shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                        {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
                    </span>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                        {chunks.map((chunk) => (
                            <ChunkRowItem key={chunk.id} chunk={chunk} selectedIndex={selectedIndex} onJumpToPage={onJumpToPage} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
