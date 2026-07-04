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

`src/app/api/chat/route.ts` → `outputChain` in `src/app/lib/runnables.ts`. This is a LangChain `RunnableSequence` pipeline with three stages:
1. **Condense**: `standaloneTemplate` + `llm` rewrites the (question + history) into a standalone question (handles follow-up/pronoun references).
2. **Retrieve**: the standalone question is passed through `retriever(filter)` (a Supabase vector store retriever, filtered by `userId`) and the retrieved docs are flattened into a single context string via `combineDocuments` (`src/app/utils/helpers.ts`).
3. **Answer**: `answerTemplate` + `llm` produces the final answer from `{context, question, history}`, streamed directly back as the `Response` body.

Prompt text lives in `src/app/lib/prompts.ts` — edit these templates to change model behavior/tone, not the runnable wiring.

### Document ingestion flow (`/api/document`)

`POST` — uploads the raw PDF to a Supabase Storage bucket (`document_store`, keyed by `${userId}.${ext}`, one file per user, `upsert: true`), parses it with `PDFLoader`, splits it with `RecursiveCharacterTextSplitter` (1000/100 chunk size/overlap), tags each chunk with `{documentName, pageNumber, userId}` metadata, deletes that user's previous embeddings (`delete_documents_by_user` RPC) before writing new ones, then embeds and stores via `vectorStore().addDocuments`.

`GET` — looks up the current user's stored file by name prefix and streams it back for the PDF viewer.

Because storage/retrieval is scoped by `userId` header (not real auth), each user effectively has exactly one active document at a time.

### Auth model — important gotcha

Login/signup (`/api/login`, `/api/signup`) hit Supabase RPCs (`verify_password`, raw `insert` into `users`) directly with **no session/JWT issued**. The client (`src/app/page.tsx`) just stores the plaintext `username` in `sessionStorage.userId` on success and sends it back as the `User-Id` header on every subsequent `/api/chat` and `/api/document` request — that header is the sole "auth" boundary and is trivially spoofable. `jose` and `@types/jsonwebtoken` are in `package.json` but are not currently wired into any route — don't assume JWT-based auth exists when reading or modifying auth code.

### Key files

- `src/app/lib/ollama.ts` — constructs the shared `ChatOllama` (`llm`) and `OllamaEmbeddings` (`embeddings`) singletons used everywhere.
- `src/app/api/chat/route.ts` — builds a `CallbackHandler` (`@langfuse/langchain`) per request and passes it to `outputChain.stream()` as `{ callbacks }`. When `LANGFUSE_PUBLIC_KEY` is absent the callbacks array is empty and tracing is skipped.
- `src/instrumentation.ts` — Next.js instrumentation hook; creates a `NodeTracerProvider` with `LangfuseSpanProcessor` and wires it via `setLangfuseTracerProvider` (`@langfuse/tracing`). Uses an isolated provider rather than `NodeSDK`/`provider.register()` because Next.js claims the global OTel provider first.
- `src/app/lib/supabase.ts` — `supabaseClient` (auth/storage/RPC) and `vectorStore(filter)` / `retriever(filter)` factories for the `documents` table.
- `src/app/lib/runnables.ts` — the LangChain chain composition described above.
- `src/app/lib/prompts.ts` — all prompt templates.
- `src/app/utils/env.ts` — single source of truth for env var access.
- `src/app/utils/helpers.ts` — small shared helpers (currently just `combineDocuments`).
- `src/app/home/page.tsx` — main chat + PDF viewer UI; renders assistant responses via `marked` with `dangerouslySetInnerHTML` and streams `/api/chat` responses chunk-by-chunk into state.
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