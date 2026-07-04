"use client";

import { useState, useEffect, useRef } from "react";
import { parse } from 'marked';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export default function Home() {
    const [messages, setMessages] = useState<{ text: string; sender: string }[]>([{ text: "Hi. How may I help you today ?", sender: "System" }]);
    const [input, setInput] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [numPages, setNumPages] = useState<number>();
    const [user, setUser] = useState<string>('');
    const [file, setFile] = useState<File>();
    // Stable ID that groups all turns in this browser session into one LangFuse trace session
    const [sessionId] = useState<string>(() => crypto.randomUUID());

    const pdfRef = useRef<HTMLDivElement>(null);
    const lastScrollTop = useRef<number>(0);

    useEffect(() => {
        const handleScroll = () => {
            if (pdfRef.current) {
                const { scrollTop, clientHeight, scrollHeight } = pdfRef.current;
                const isAtBottom = scrollTop + clientHeight >= scrollHeight;
                const isAtTop = scrollTop === 0;

                if (isAtBottom && pageNumber < (numPages || 0) && lastScrollTop.current !== scrollTop) {
                    lastScrollTop.current = scrollTop;
                    handleNextPage();
                } else if (isAtTop && pageNumber > 1 && lastScrollTop.current !== scrollTop) {
                    lastScrollTop.current = scrollTop;
                    handlePrevPage();
                }
            }
        };

        const currentPdfRef = pdfRef.current;
        currentPdfRef?.addEventListener("scroll", handleScroll);

        return () => {
            currentPdfRef?.removeEventListener("scroll", handleScroll);
        };
    }, [pdfRef, pageNumber, numPages]);

    useEffect(() => {
        const userId = sessionStorage.getItem('userId') || '';
        setUser(userId);
    }, [])

    useEffect(() => {
        if (!user) return;
        getFile();
    }, [user])

    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        const target = event.target as HTMLAnchorElement; // Type assertion
        const hrefAttribute = target?.attributes?.getNamedItem('href'); // Get the href attribute
        if (hrefAttribute?.value) {
            event.preventDefault();
            const pageNum = hrefAttribute?.value.split(".")[0]?.replace('#', '');
            setPageNumber(Number(pageNum))
        }
    }

    const handleSendMessage = async (event: React.FormEvent) => {
        event.preventDefault(); // Prevents page refresh
        if (input.trim()) {
            setMessages([...messages, { text: input, sender: "User" }]);
            setInput(""); // Clear the input box
            setLoading(true); // Set loading to true

            try {
                const response = await fetch('/api/chat', {
                    method: "POST",
                    body: JSON.stringify({ question: input, history: messages }),
                    headers: {
                        'User-Id': user,
                        'Session-Id': sessionId,
                    }
                });
                if (response.body) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let systemMessage = ""; // Initialize a variable to accumulate the message

                    // Add an initial system message entry
                    setMessages((prevMessages) => [...prevMessages, { text: "", sender: "System" }]);

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value);
                        systemMessage += chunk; // Accumulate the message
                        // Update the last message in the messages array
                        setMessages((prevMessages) => {
                            const updatedMessages = [...prevMessages];
                            updatedMessages[updatedMessages.length - 1] = { text: systemMessage, sender: "System" };
                            return updatedMessages;
                        });
                    }
                } else {
                    console.error("Response body is null");
                }
            } catch (error) {
                console.error("Error fetching response:", error);
            } finally {
                setLoading(false); // Set loading to false
            }
        }
    };

    function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
        setNumPages(numPages);
    }

    const handleNextPage = () => {
        if (pageNumber < (numPages || 0)) {
            setPageNumber(pageNumber + 1);
        }
    };

    const handlePrevPage = () => {
        if (pageNumber > 1) {
            setPageNumber(pageNumber - 1);
        }
    };

    const getFile = async () => {
        const fileRes = await fetch('/api/document', {
            headers: {
                'User-Id': user
            }
        });
        if (!fileRes.ok) return;
        console.log(fileRes)
        const blob = await fileRes.blob(); // Convert Response to Blob
        const file = new File([blob], 'document.pdf'); // Create a File object
        setFile(file); // Set the File object
    }

    const handleUpload = async (file: File | null) => {
        if (file) {
            const formData = new FormData();
            formData.append("file", file);

            await fetch("/api/document", {
                method: "POST",
                body: formData,
                headers: {
                    'User-Id': user
                }
            });
            getFile()
        }
    }

    return (
        <div className="flex overflow-hidden gap-4 p-4 bg-gray-50" style={{ height: "93vh" }}>
            {/* Chat Section */}
            <div className="w-1/2 flex flex-col bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-gray-50 to-white">
                    {messages.map((message, index) => (
                        <div 
                            key={index} 
                            className={`p-4 rounded-xl shadow-sm max-w-[85%] ${
                                message.sender === "User" 
                                    ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white ml-auto" 
                                    : "bg-white text-gray-800 border border-gray-100"
                            }`}
                        >
                            <span
                                onClick={handleClick}
                                className="parsed-text whitespace-pre-wrap"
                                dangerouslySetInnerHTML={{ __html: parse(message.text) }}
                            />
                        </div>
                    ))}
                    {loading && (
                        <div className="flex justify-center">
                            <div className="animate-pulse text-blue-600 font-medium">Loading...</div>
                        </div>
                    )}
                </div>
                <div className="border-t border-gray-100 p-4 bg-white">
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <input
                            type="text"
                            className="flex-1 p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-700 bg-gray-50"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            disabled={loading}
                        />
                        <button
                            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-sm disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed"
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? "Sending..." : "Send"}
                        </button>
                    </form>
                </div>
            </div>

            {/* PDF Section */}
            <div className="w-1/2 flex flex-col bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
                {file ? (
                    <>
                        <div ref={pdfRef} className="flex-1 overflow-auto p-4 bg-gradient-to-b from-gray-50 to-white">
                            <div className="flex flex-col items-center">
                                <Document file={file} onLoadSuccess={onDocumentLoadSuccess}>
                                    <Page pageNumber={pageNumber} />
                                </Document>
                                <p className="mt-4 text-gray-600 font-medium">
                                    Page {pageNumber} of {numPages}
                                </p>
                            </div>
                        </div>
                        <div className="border-t border-gray-100 p-4 flex justify-center gap-4 bg-white">
                            <button
                                onClick={handlePrevPage}
                                disabled={pageNumber === 1}
                                className={`px-6 py-2 rounded-xl transition-all shadow-sm ${
                                    pageNumber === 1 
                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white'
                                }`}
                            >
                                ← Previous
                            </button>
                            <button
                                onClick={handleNextPage}
                                disabled={pageNumber === numPages}
                                className={`px-6 py-2 rounded-xl transition-all shadow-sm ${
                                    pageNumber === numPages 
                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white'
                                }`}
                            >
                                Next →
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full bg-gradient-to-b from-gray-50 to-white">
                        <div className="text-center">
                            <input
                                type="file"
                                id="fileUpload"
                                className="hidden"
                                onChange={(e) => handleUpload(e.target.files ? e.target.files[0] : null)}
                                accept="application/pdf"
                            />
                            <button
                                className="px-8 py-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg group"
                                onClick={() => document.getElementById('fileUpload')?.click()}
                            >
                                <div className="text-xl font-semibold">Upload PDF</div>
                                <div className="text-sm mt-2 text-blue-100 group-hover:text-white transition-colors">
                                    Click to browse files
                                </div>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

