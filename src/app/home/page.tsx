"use client";

import { useState, useEffect } from "react";
import { parse } from 'marked';
import { RAG_MODES, DEFAULT_RAG_MODE, type RagMode } from "@/app/lib/rag-strategies/modes";
import { Spinner } from "@/app/components/Spinner";
import type { RetrievedSource } from "@/app/utils/helpers";

interface ChatMessage {
    text: string;
    sender: "User" | "System";
    sources?: RetrievedSource[];
}

// Turns the LLM's inline "[Source 2]" citation markers into markdown links so `marked`
// renders them as clickable anchors. Matches "[Source 2]" and also "[Source 2 | Page 5]"
// since models sometimes echo the full context label instead of the short form the prompt asks for.
function linkifyCitations(text: string): string {
    return text.replace(/\[Source (\d+)(?:\s*\|[^\]]*)?\]/g, (_match, id) => `[Source ${id}](#cite-${id})`);
}

function uniquePages(sources: RetrievedSource[]): number[] {
    return Array.from(new Set(sources.map((source) => source.pageNumber))).sort((a, b) => a - b);
}

export default function Home() {
    const [messages, setMessages] = useState<ChatMessage[]>([{ text: "Hi. How may I help you today ?", sender: "System" }]);
    const [input, setInput] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [user, setUser] = useState<string>('');
    const [ragMode, setRagMode] = useState<RagMode>(DEFAULT_RAG_MODE);
    // Stable ID that groups all turns in this browser session into one LangFuse trace session
    const [sessionId] = useState<string>(() => crypto.randomUUID());

    const [activePanel, setActivePanel] = useState<"chat" | "document">("chat");
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [fileChecked, setFileChecked] = useState<boolean>(false);
    const [uploading, setUploading] = useState<boolean>(false);
    const [pageNumber, setPageNumber] = useState<number>(1);

    useEffect(() => {
        const userId = sessionStorage.getItem('userId') || '';
        setUser(userId);
    }, [])

    useEffect(() => {
        if (!user) return;
        getFile();
    }, [user])

    // The embedded PDF is always backed by an object URL — revoke the previous one whenever
    // it's replaced (new upload) or the page unmounts, so blobs don't pile up in memory.
    useEffect(() => {
        if (!fileUrl) return;
        return () => URL.revokeObjectURL(fileUrl);
    }, [fileUrl])

    const getFile = async () => {
        const res = await fetch('/api/document', { headers: { 'User-Id': user } });
        if (!res.ok) {
            res.body?.cancel();
            setFileUrl(null);
            setFileChecked(true);
            return;
        }
        const blob = await res.blob();
        setFileUrl(URL.createObjectURL(blob));
        setFileChecked(true);
    }

    const jumpToPage = (page: number) => {
        setPageNumber(page);
        setActivePanel('document');
    }

    const handleAnswerClick = (event: React.MouseEvent<HTMLSpanElement>, messageIndex: number) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href?.startsWith('#cite-')) return;
        event.preventDefault();
        const sourceId = Number(href.replace('#cite-', ''));
        const source = messages[messageIndex]?.sources?.find((candidate) => candidate.id === sourceId);
        if (source) jumpToPage(source.pageNumber);
    }

    const handleSendMessage = async (event: React.FormEvent) => {
        event.preventDefault(); // Prevents page refresh
        if (!input.trim()) return;

        const nextMessages = [...messages, { text: input, sender: "User" as const }];
        const systemIndex = nextMessages.length;
        setMessages([...nextMessages, { text: "", sender: "System", sources: [] }]);
        setInput("");
        setLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: "POST",
                body: JSON.stringify({ question: input, history: messages, ragMode }),
                headers: {
                    'User-Id': user,
                    'Session-Id': sessionId,
                }
            });
            if (!response.body) {
                console.error("Response body is null");
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let answerText = "";

            const updateSystemMessage = (patch: Partial<ChatMessage>) => {
                setMessages((prev) => {
                    const updated = [...prev];
                    updated[systemIndex] = { ...updated[systemIndex], ...patch };
                    return updated;
                });
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const rawEvents = buffer.split("\n\n");
                buffer = rawEvents.pop() ?? "";

                for (const rawEvent of rawEvents) {
                    if (!rawEvent.trim()) continue;
                    let eventName = "message";
                    let data = "";
                    for (const line of rawEvent.split("\n")) {
                        if (line.startsWith("event:")) eventName = line.slice(6).trim();
                        else if (line.startsWith("data:")) data = line.slice(5).trim();
                    }
                    if (!data) continue;

                    const payload = JSON.parse(data);
                    if (eventName === "sources") {
                        updateSystemMessage({ sources: payload });
                    } else if (eventName === "token") {
                        answerText += payload.text;
                        updateSystemMessage({ text: answerText });
                    } else if (eventName === "error") {
                        answerText += `\n\n_${payload.message}_`;
                        updateSystemMessage({ text: answerText });
                    }
                }
            }
        } catch (error) {
            console.error("Error fetching response:", error);
        } finally {
            setLoading(false); // Set loading to false
        }
    };

    const handleUpload = async (file: File | null) => {
        if (!file) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            await fetch("/api/document", {
                method: "POST",
                body: formData,
                headers: {
                    'User-Id': user
                }
            });
            setPageNumber(1);
            await getFile();
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 bg-paper p-3 sm:p-4 md:flex-row md:gap-4">
            <input
                type="file"
                id="fileUpload"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files ? e.target.files[0] : null)}
                accept="application/pdf"
            />

            {/* Mobile-only panel switcher */}
            <div className="flex shrink-0 gap-2 md:hidden">
                <button
                    type="button"
                    onClick={() => setActivePanel('chat')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${activePanel === 'chat' ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-ink-soft'}`}
                >
                    Chat
                </button>
                <button
                    type="button"
                    onClick={() => setActivePanel('document')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${activePanel === 'document' ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-ink-soft'}`}
                >
                    Document
                </button>
            </div>

            {/* Chat Section */}
            <div className={`${activePanel === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card md:flex md:w-1/2`}>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                        <h2 className="text-sm font-semibold text-ink">Chat</h2>
                        <p className="text-xs text-ink-soft">Ask a question about your document</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="ragMode" className="hidden text-[11px] font-semibold uppercase tracking-wide text-ink-faint sm:inline">Mode</label>
                        <select
                            id="ragMode"
                            className="rounded-lg border border-border bg-paper px-2.5 py-1.5 font-mono text-xs text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25"
                            value={ragMode}
                            onChange={(e) => setRagMode(e.target.value as RagMode)}
                            disabled={loading}
                        >
                            {RAG_MODES.map((mode) => (
                                <option key={mode.value} value={mode.value}>{mode.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {messages.map((message, index) => (
                        <div
                            key={index}
                            className={`max-w-[90%] animate-message-in rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm sm:max-w-[85%] ${
                                message.sender === "User"
                                    ? "ml-auto rounded-br-sm bg-accent text-surface"
                                    : "rounded-bl-sm border border-border bg-surface-muted text-ink"
                            }`}
                        >
                            <span
                                onClick={(e) => handleAnswerClick(e, index)}
                                className="parsed-text whitespace-pre-wrap"
                                dangerouslySetInnerHTML={{ __html: parse(linkifyCitations(message.text)) }}
                            />
                            {message.sender === "System" && !!message.sources?.length && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {uniquePages(message.sources).map((page) => (
                                        <button
                                            key={page}
                                            type="button"
                                            onClick={() => jumpToPage(page)}
                                            className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
                                        >
                                            Page {page}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    {loading && (
                        <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-surface-muted px-4 py-3.5">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.3s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.15s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                        </div>
                    )}
                </div>

                <div className="shrink-0 border-t border-border p-3 sm:p-4">
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <input
                            type="text"
                            className="min-w-0 flex-1 rounded-xl border border-border bg-paper px-4 py-3 text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message…"
                            disabled={loading}
                        />
                        <button
                            className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-3 font-medium text-surface transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
                            type="submit"
                            disabled={loading || !input.trim()}
                        >
                            {loading ? (
                                <Spinner className="h-4 w-4" />
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                    <path d="M4.5 12 19.5 4.5 15 19.5l-3.5-6L4.5 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                    <path d="M11.5 13.5 19.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                </svg>
                            )}
                            <span className="hidden sm:inline">Send</span>
                        </button>
                    </form>
                </div>
            </div>

            {/* Document Section — the PDF stays embedded and open the whole time; citations
                jump it to the right page via the iframe's #page= fragment, and the browser's
                native PDF viewer handles manual scroll/zoom/search/print from there. */}
            <div className={`${activePanel === 'document' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card md:flex md:w-1/2`}>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                        <h2 className="text-sm font-semibold text-ink">Document</h2>
                        <p className="text-xs text-ink-soft">{fileUrl ? `Page ${pageNumber}` : "Nothing uploaded yet"}</p>
                    </div>
                    {fileUrl && (
                        <button
                            onClick={() => document.getElementById('fileUpload')?.click()}
                            disabled={uploading}
                            className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-muted disabled:opacity-50"
                        >
                            {uploading ? "Uploading…" : "Replace"}
                        </button>
                    )}
                </div>

                {!fileChecked ? (
                    <div className="flex flex-1 items-center justify-center">
                        <Spinner className="h-6 w-6 text-ink-faint" />
                    </div>
                ) : fileUrl ? (
                    <iframe
                        key={pageNumber}
                        src={`${fileUrl}#page=${pageNumber}`}
                        title="Uploaded document"
                        className="min-h-0 w-full flex-1 border-0"
                    />
                ) : (
                    <div className="flex flex-1 items-center justify-center p-8">
                        <button
                            onClick={() => document.getElementById('fileUpload')?.click()}
                            disabled={uploading}
                            className="group flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border px-8 py-12 text-center transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {uploading ? (
                                <Spinner className="h-7 w-7 text-accent" />
                            ) : (
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-soft transition-colors group-hover:bg-accent-soft group-hover:text-accent">
                                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                                        <path d="M12 16V4m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                    </svg>
                                </span>
                            )}
                            <span>
                                <span className="block text-sm font-semibold text-ink">{uploading ? "Uploading…" : "Upload a PDF"}</span>
                                <span className="mt-1 block text-xs text-ink-soft">Click to browse — one document per account</span>
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
