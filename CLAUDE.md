# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js + Turbopack) on localhost:3000
npm run build    # production build
npm run start    # run production build
npm run lint     # next lint (eslint.config.mjs, flat config extending next/core-web-vitals + next/typescript)
```

There is no test suite in this repo currently.

### Local setup dependencies

The app requires two external services running before `npm run dev` will work end-to-end:
- **Ollama** running locally/remotely (for both chat completion and embeddings models).
- **Supabase** project with `pgvector` enabled — run the SQL in `supabaseScripts.txt` once against the project to create the `documents` table/`match_documents` RPC, the `users` table with password hashing trigger, `verify_password` RPC, and `delete_documents_by_user` RPC. A `document_store` storage bucket is also expected (used by `src/app/api/document/route.ts`).

Env vars (see `env.example`): `SUPABASE_API_KEY`, `SUPABASE_URL`, `OLLAMA_LLM_BASE_URL`, `OLLAMA_LLM_MODEL`, `OLLAMA_EMBEDDINGS_BASE_URL`, `OLLAMA_EMBEDDINGS_MODEL`. Read centrally through `src/app/utils/env.ts` — always add new env vars there rather than calling `process.env` directly elsewhere.

**Optional:** `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL` — when present, every `/api/chat` request is traced via LangFuse (latency, token counts, prompt/completion per chain node). The app runs normally without them. Tracing uses the OpenTelemetry-based `@langfuse/langchain` + `@langfuse/otel` SDK (v5), not the legacy `langfuse-langchain` package — that legacy package only supports LangChain 0.3.x and is incompatible with this project's `@langchain/core` v1.x stack.

## Architecture

This is a Next.js (App Router) RAG chat app: a PDF is uploaded, chunked and embedded into Supabase/pgvector, and a chat interface answers questions grounded in the retrieved chunks, streamed back to the client.

### Request flow for chat (`/api/chat`)

`src/app/api/chat/route.ts` reads an optional `ragMode` field off the request body and dispatches to `buildRagChain(mode, filter)` from `src/app/lib/rag-strategies/index.ts` — a registry (`RAG_STRATEGIES`) mapping a `RagMode` string to a strategy builder `(filter) => RunnableSequence`, exactly as before citations existed. Unknown/missing modes fall back to `DEFAULT_RAG_MODE` (`"condense"`). The chosen mode is also added to the LangFuse trace tags (`rag-mode:<mode>`) so traces can be filtered/compared per strategy.

Strategies currently registered in `src/app/lib/rag-strategies/` are plain LangChain runnable compositions — no hand-rolled async orchestration:
- **`condense`** (default, `condense.ts`) — three-stage `RunnableSequence`: (1) `standaloneTemplate` + `llm` rewrites question+history into a standalone question, handling follow-up/pronoun references; (2) the standalone question flows through `retrieveAndBuildContext(filter)` (`rag-strategies/retrieval.ts`), a `RunnableLambda` that retrieves via `retriever(filter)` and calls `buildContext` (`src/app/utils/helpers.ts`) to number each chunk as `[Source N | Page P]`, returning `{context, sources}`; (3) `answerTemplate` + `llm` streams the final answer from `{context, question, history}`, instructed to cite chunks inline as `[Source N]`.
- **`naive`** (`naive.ts`) — control-group baseline: embeds the raw question directly with no condensing/rewriting, otherwise the same retrieve → `buildContext` → answer shape.

`retrieveAndBuildContext` (shared by both strategies) and the final answer LLM call are each given an explicit `runName` (`"retrieveAndBuildContext"` and `"answerLLM"`) via `.withConfig({runName})`. This is purely so `/api/chat` can pick their events out of `.streamEvents()` by name — it has no effect on chain behavior.

`src/app/lib/rag-strategies/modes.ts` holds the `RagMode` type and UI labels and has **no LangChain/LLM imports** so it can be safely imported from client components (see `src/app/home/page.tsx`'s mode picker) — everything else in that folder is server-only.

Prompt text lives in `src/app/lib/prompts.ts` — edit these templates to change model behavior/tone, not the runnable wiring. Add a new RAG technique by adding a strategy file (a `RunnableSequence` factory, typically built around `retrieveAndBuildContext`) + registering it in both `rag-strategies/index.ts` (`RAG_STRATEGIES`) and `rag-strategies/modes.ts` (`RAG_MODES`, for the UI picker).

### Streaming protocol and source citations

`/api/chat` calls `chain.streamEvents(input, {version: "v2", callbacks})` rather than `chain.stream()`, and responds with `Content-Type: text/event-stream` (SSE) rather than raw text — this is what lets the response carry a structured `sources` payload alongside the answer tokens without changing the strategy chains into anything other than plain runnables. The route filters the raw LangChain event stream down to three SSE event types: one `sources` event (the `on_chain_end` output of the `retrieveAndBuildContext` step — a JSON array of `{id, pageNumber}`, emitted before any tokens because that step finishes before the answer LLM starts generating), one `token` event per `on_chat_model_stream` chunk from the step named `answerLLM` (`{text: "..."}`), then a terminal `done` (or `error`) event. The frontend (`src/app/home/page.tsx`) hand-parses this over a raw `fetch` + `ReadableStream` reader (splitting on blank lines) rather than using `EventSource`, because `EventSource` can't send the POST body/custom headers this route needs.

The LLM is prompted (`answerTemplate` in `prompts.ts`) to cite chunks inline as `[Source N]`; the client turns those into clickable markdown links (`linkifyCitations` in `home/page.tsx`) that look up that source's `pageNumber` and jump the embedded PDF viewer straight to it. Each assistant message also renders a row of "Page N" chips (deduped from its `sources`) as a citation-free fallback way to jump pages. The PDF itself is rendered via a plain `<iframe src="<blob-url>#page=N">` — no `react-pdf`/pdfjs — so it stays embedded and visible the whole time ("always open") and the browser's own PDF viewer supplies zoom/search/print/manual scroll for free. Because `<iframe>` can't send the `User-Id` auth header, the client still fetches the file with `fetch()` first and turns the response into an object URL, exactly like the pre-citation-era implementation did.

### Document ingestion flow (`/api/document`)

`POST` — uploads the raw PDF to a Supabase Storage bucket (`document_store`, keyed by `${userId}.${ext}`, one file per user, `upsert: true`), parses it with `PDFLoader`, splits it with `RecursiveCharacterTextSplitter` (1000/100 chunk size/overlap), tags each chunk with `{documentName, pageNumber, userId}` metadata, deletes that user's previous embeddings (`delete_documents_by_user` RPC) before writing new ones, then embeds and stores via `vectorStore().addDocuments`.

`GET` — looks up the current user's stored file by name prefix and streams it back; the client wraps it in an object URL for the embedded `<iframe>` PDF viewer.

Because storage/retrieval is scoped by `userId` header (not real auth), each user effectively has exactly one active document at a time.

### Auth model — important gotcha

Login/signup (`/api/login`, `/api/signup`) hit Supabase RPCs (`verify_password`, raw `insert` into `users`) directly with **no session/JWT issued**. The client (`src/app/page.tsx`) just stores the plaintext `username` in `sessionStorage.userId` on success and sends it back as the `User-Id` header on every subsequent `/api/chat` and `/api/document` request — that header is the sole "auth" boundary and is trivially spoofable. `jose` and `@types/jsonwebtoken` are in `package.json` but are not currently wired into any route — don't assume JWT-based auth exists when reading or modifying auth code.

### Key files

- `src/app/lib/ollama.ts` — constructs the shared `ChatOllama` (`llm`) and `OllamaEmbeddings` (`embeddings`) singletons used everywhere.
- `src/app/api/chat/route.ts` — builds a `CallbackHandler` (`@langfuse/langchain`) per request, gets a plain `RunnableSequence` from `buildRagChain`, and drives it with `.streamEvents()` to produce the `sources`/`token`/`done` SSE response described above. When `LANGFUSE_PUBLIC_KEY` is absent the callbacks array is empty and tracing is skipped.
- `src/instrumentation.ts` — Next.js instrumentation hook; creates a `NodeTracerProvider` with `LangfuseSpanProcessor` and wires it via `setLangfuseTracerProvider` (`@langfuse/tracing`). Uses an isolated provider rather than `NodeSDK`/`provider.register()` because Next.js claims the global OTel provider first.
- `src/app/lib/supabase.ts` — `supabaseClient` (auth/storage/RPC) and `vectorStore(filter)` / `retriever(filter)` factories for the `documents` table.
- `src/app/lib/rag-strategies/` — the `RagMode` registry and chain compositions described above (`index.ts`, `modes.ts`, `condense.ts`, `naive.ts`, `retrieval.ts`).
- `src/app/lib/prompts.ts` — all prompt templates.
- `src/app/utils/env.ts` — single source of truth for env var access.
- `src/app/utils/helpers.ts` — `buildContext(retrievedDocs)`, which numbers chunks into a `[Source N | Page P]`-prefixed context string for the LLM plus a parallel `{id, pageNumber}` sources array for the client (the sole place chunk metadata is preserved instead of discarded).
- `src/app/home/page.tsx` — main chat + Document UI, responsive (stacked/tabbed below `md`, side-by-side at `md`+). Renders assistant responses via `marked` with `dangerouslySetInnerHTML`, parses the `/api/chat` SSE stream event-by-event into state, and keeps the uploaded PDF permanently embedded in an `<iframe>` that inline `[Source N]` citations (and per-message "Page N" chips) jump to the right page.
- `supabaseScripts.txt` — the SQL schema/RPCs this app depends on; not run automatically, must be applied manually to a new Supabase project.

## Definition of done
Run `npm run lint` and `npm run build` — both must pass before any change is complete.
There is no test suite; manually verify affected routes in the running dev server.

## Supabase scripts

`supabaseScripts.txt` is the source of truth for the Supabase schema and RPCs. **Always keep it in sync**: any time you add, modify, or remove a table, column, function, trigger, or extension, update `supabaseScripts.txt` to reflect the change before considering the task done.

## Guardrails — never do this
- NEVER change the vector dimension from 768 without also updating the `documents` table
  column and the `match_documents` RPC in Supabase — a mismatch silently breaks retrieval.
- NEVER add application-level password hashing — the Supabase `before_insert_or_update`
  trigger handles it via pgcrypto. Adding it in code will double-hash and break login.
- The `User-Id` header is NOT verified auth — it is trivially spoofable. Never treat it
  as a security boundary; always be explicit that this is the current limitation.
- Always add new env vars through `src/app/utils/env.ts` — never call `process.env`
  directly elsewhere in the codebase.
- Keep `src/app/lib/rag-strategies/*` (`condense.ts`, `naive.ts`, and any new strategy)
  as plain LangChain runnable compositions (`RunnableSequence`/`RunnableLambda`/prompt
  templates piped together) — this was a deliberate cleanup, not an oversight. Don't
  reintroduce hand-rolled `async (input) => {...}` orchestration in a strategy file to
  extract `sources` early; instead give the relevant step a `runName` via `.withConfig()`
  (see `retrieval.ts`'s `retrieveAndBuildContext` and `condense.ts`/`naive.ts`'s
  `answerLLM`) and read it out in `api/chat/route.ts` via `chain.streamEvents()`.