# Feliz (Renter's Resource Guide)

TypeScript monorepo shell for a tenant rights and housing resource navigator. The integration points are placeholders.

## Requirements

Node.js 22 or newer and npm.

## Install

```sh
npm install
```

Copy `.env.example` to `.env` when credentials are available. The placeholder bot does not read them.

## Project structure

- `apps/bot`: messaging app entry point
- `apps/ingest`: source ingestion entry point
- `packages/agent`: agent and tool placeholders
- `packages/rag`: retrieval placeholders
- `packages/routing`: routing placeholders
- `packages/db`: data access placeholders
- `supabase/`: future migrations and seed data
- `tests/`: shared tests

## Development

```sh
npm run dev        # build and start the placeholder bot
npm run build      # compile all workspaces
npm run typecheck  # check all workspaces
npm test           # run Vitest
```

Workspace packages use the `@feliz/*` scope and can be imported through npm workspace links as their implementations are added.

## RAG (`packages/rag`, `apps/ingest`)

1. Run `supabase/migrations/20261017000000_rag_documents.sql` once in the Supabase SQL editor.
2. Set `GEMINI_API_KEY` (embeddings: `gemini-embedding-2`, 1536 dims), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
3. Load scraped data: `npm run ingest -w @feliz/ingest -- /abs/path/chunks.jsonl --replace`, or call `ingestChunks(chunks)` from `apps/ingest/src/ingest.ts` in a TypeScript scraper.

`chunks.jsonl` has one JSON object per line: `{ id, source, source_name, url, title, text }`
(type `ScrapedChunk` in `packages/db`). `source` should be a key in `apps/ingest/src/source-meta.ts`,
which sets each source's jurisdictions and authority.

Using it from the agent:

```ts
import { retrieve, formatContext, usedCitations } from "@feliz/rag";

const { passages, confidence } = await retrieve(userText, { jurisdiction: "city_of_la" });
if (confidence === "none") { /* don't guess: say so and refer to LAHD / Stay Housed LA */ }
const context = formatContext(passages); // put in the prompt; ask the model to cite [1], [2]
const sources = usedCitations(answer, passages); // URLs for a "Sources:" footer
```

`jurisdiction` is `city_of_la`, `la_county` or `california`; statewide law is always included.
Confidence thresholds in `packages/rag/src/retrieve.ts` are starting guesses until real data is in.
