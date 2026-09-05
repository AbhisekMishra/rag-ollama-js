# RAG-Ollama-JS

https://github.com/user-attachments/assets/e75e3571-098d-4654-b000-5fd23142f64f

## Introduction

RAG-Ollama-JS is a hands-on **learning project** for exploring Retrieval-Augmented Generation end-to-end — not a polished product. It's a Next.js app where you upload a PDF, chat with it, and can switch between eleven different RAG strategies per-question to see how each one changes retrieval and the final answer, with a live pipeline visualizer and optional LangFuse tracing to inspect what actually happened at each stage.

Built with LangChain.js, Ollama (local/remote LLM + embeddings), and Supabase/pgvector for storage and retrieval.

## Features

- **Eleven RAG strategies, switchable per question** — grouped by which stage of the pipeline they change:
  - **Retrieval strategy**: Naive RAG, Hybrid Search (keyword + vector, fused via RPC), Sentence-Window Retrieval, Parent-Document Retrieval, Auto-Merging Retrieval (like parent-document, but only promotes a chunk to its full parent when enough sibling children agree)
  - **Query transformation**: Query Condensing (default — rewrites follow-ups into standalone questions), Multi-Query (fans out over several phrasings), HyDE (retrieves on a hypothetical answer draft instead of the question)
  - **Post-retrieval**: Re-ranking (LLM scores 20 over-fetched candidates and keeps the top 4), Contextual Compression (LLM strips irrelevant sentences out of each retrieved chunk)
  - **Iterative / self-correcting**: Self-RAG (judges retrieved-context sufficiency before answering, rewriting the question and retrying up to 2 hops if it's thin, then reports a post-hoc groundedness score for the answer it gave)
- **Live pipeline visualizer** — a step-by-step diagram of whichever strategy is selected, showing each stage go pending → active → done in real time, with the actual prompt/completion and retrieved chunks available behind a "show raw I/O" disclosure per stage. Also frozen per assistant message so past answers stay inspectable.
- **Inline source citations** — the LLM cites `[Source N]`, the client turns those into clickable links that jump the embedded PDF to the right page, plus "Page N" chips as a citation-free fallback.
- **Chunks viewer** — browse the raw stored rows across all three chunk indexes (parent chunks, sentences, child chunks) that back the different retrieval strategies.
- **Optional LangFuse tracing** — when configured, every chat request is traced (latency, token counts, prompt/completion per chain node, tagged with the active RAG mode) so strategies can be compared side by side.
- **Streaming chat** over SSE, with an always-visible embedded PDF viewer (plain `<iframe>`, no client-side PDF renderer).

## Why this project exists

This repo exists to build a working, comparable implementation of the major RAG techniques rather than reading about them — each strategy is a small, isolated LangChain runnable composition so its effect can be studied in isolation via the pipeline visualizer and LangFuse traces. Planned next steps include a RAGAS-style automated evaluation layer (faithfulness / answer relevancy) and a LangFuse-backed leaderboard for comparing strategies quantitatively rather than just eyeballing answers.

## Evaluation (raglens)

Automated scoring is planned via [**raglens**](https://github.com/AbhisekMishra/raglens) — a small TypeScript package (also built by the author of this repo) that reimplements RAGAS-style RAG metrics without requiring Python. It scores a `{question, answer, contexts}` sample against a pluggable `Judge` (an Ollama adapter ships built-in) and currently provides:
- **faithfulness** — decomposes the answer into factual statements and verifies each against the retrieved contexts
- **answer_relevancy** — LLM-judged relevance of the answer to the question

`raglens` is already listed as a dependency (`package.json`) but is **not yet wired into this app** — the plan is a golden question set run through each `ragMode`, scored with `raglens`, and pushed to LangFuse so the strategies above can be compared quantitatively instead of by eye.

## Prerequisites

- Node.js (Latest LTS version)
- Ollama running locally or remotely (chat model + embeddings model)
- Supabase project with `pgvector` enabled

## Installation

1. Clone the repository:
```bash
git clone https://github.com/AbhisekMishra/rag-ollama-js.git
cd rag-ollama-js
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
   - Copy `env.example` to `.env`
   - Update the following variables:
```plaintext
SUPABASE_API_KEY=your_supabase_api_key
SUPABASE_URL=your_supabase_project_url
OLLAMA_LLM_BASE_URL=http://localhost:11434
OLLAMA_LLM_MODEL=your_preferred_model
OLLAMA_EMBEDDINGS_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDINGS_MODEL=nomic-embed-text
```
   - Optionally, add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL` to enable request tracing. The app runs fine without them.

4. Run the Supabase setup script mentioned in **[`supabaseScripts.txt`](https://github.com/AbhisekMishra/rag-ollama-js/blob/main/supabaseScripts.txt)** against your project. This creates the core `documents`/`match_documents` table+RPC, the `users` table and password RPCs, plus the extra tables/RPCs required by hybrid search, sentence-window, and parent-document retrieval specifically (see the file's step markers). A `document_store` storage bucket is also expected.

5. Start the development server:
```bash
npm run dev
```

## Usage

1. **Upload Document**:
   - Click the "Upload File" button in the right panel
   - Select a PDF document to upload
   - The document is chunked and embedded into Supabase across the indexes needed by the strategies above

2. **Pick a RAG strategy**:
   - Choose a mode from the picker before asking a question
   - Watch the pipeline visualizer walk through that strategy's stages live

3. **Ask Questions**:
   - Type your question in the chat input
   - Receive a streamed, context-aware, citation-linked answer
   - Expand "How this answer was generated" on any answer to replay its pipeline trace

4. **View Document**:
   - The PDF stays open in an embedded viewer; citations and page chips jump it to the right page

## Technical Stack

- **Frontend**: Next.js (App Router) with TypeScript, Tailwind CSS
- **RAG orchestration**: LangChain.js (`@langchain/core`, plain `RunnableSequence`/`RunnableLambda` compositions per strategy)
- **Language model & embeddings**: Ollama
- **Vector store**: Supabase / pgvector
- **Observability**: LangFuse (OpenTelemetry-based, optional)
- **PDF viewing**: plain `<iframe>` over an object URL (no client-side PDF renderer)

## Project Structure

```plaintext
src/
├── app/
│   ├── api/                  # API routes: chat (SSE streaming), document ingestion, auth
│   ├── home/                 # Main chat + document UI
│   ├── components/           # RagPipelineVisualizer and other UI pieces
│   ├── lib/
│   │   ├── rag-strategies/   # One file per RAG technique + the mode registry
│   │   ├── ollama.ts         # Shared ChatOllama / OllamaEmbeddings singletons
│   │   ├── supabase.ts       # Supabase client + per-index vector store/retriever factories
│   │   ├── sentence-window.ts
│   │   ├── parent-document.ts
│   │   └── prompts.ts        # All prompt templates
│   └── utils/                # Helper functions and centralized env config
└── instrumentation.ts        # LangFuse/OpenTelemetry wiring
```

See [`CLAUDE.md`](CLAUDE.md) for a deep dive into how each RAG strategy and the streaming/citation/visualizer pipeline actually works.

## A note on auth

Login/signup issue no session or JWT — the client just stores the username client-side and sends it back as a `User-Id` header on every request. This is **not** a real auth boundary (it's trivially spoofable); it exists only to scope one user to one uploaded document at a time, which is enough for a learning/demo project but not for production use.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
