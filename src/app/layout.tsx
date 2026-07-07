import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAG Chat — Ask your documents",
  description: "Chat with your PDFs, answered locally with Ollama.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-paper text-ink`}
      >
        <div className="flex h-screen flex-col overflow-hidden">
          <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3 py-3 sm:px-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-surface">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9.379a1.5 1.5 0 0 1 1.06.44l3.622 3.621a1.5 1.5 0 0 1 .439 1.06V19.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-15Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M8.5 12.5h7M8.5 15.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">
              RAG Chat <span className="hidden font-normal text-ink-soft sm:inline">— ask your documents</span>
            </h1>
          </header>

          <main className="min-h-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
