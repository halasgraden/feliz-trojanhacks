# Feliz (Renter's Resource Guide)

TypeScript monorepo for a tenant rights and housing resource navigator. Gemini embeddings, corpus ingestion, Supabase data access and retrieval are implemented. Photon Spectrum connects the bot to iMessage and currently echoes text; the agent workflow still needs to connect retrieved evidence to answer generation.

## Requirements

Node.js 24 LTS and npm are recommended (Node 22.12+ is also supported by the test runner).

## Install

```sh
npm ci
```

Copy `.env.example` to `.env` and fill in `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` from your Photon project settings. The bot loads this file automatically. Photon uses these two credentials for the [stable Spectrum SDK](https://photon.codes/docs/spectrum-ts/getting-started); `PHOTON_API_KEY` is not used by this SDK.

The bot connects to the iMessage line enabled in your Photon project. On Photon's shared line, add your phone under Users before testing. See Photon's [provider guide](https://photon.codes/docs/spectrum-ts/providers).

## Project structure

- `apps/bot`: messaging app entry point
- `apps/ingest`: source ingestion entry point
- `packages/agent`: agent and tool placeholders
- `packages/rag`: local embeddings, scoped hybrid retrieval and source citations
- `packages/routing`: routing placeholders
- `packages/db`: server-side Supabase corpus reads and writes
- `supabase/`: future migrations and seed data
- `tests/`: shared tests

## Development

```sh
npm run dev        # build and initialize Photon messaging when configured
npm run start      # build and start the bot
npm run build      # compile all workspaces
npm run typecheck  # check all workspaces
npm test           # run Vitest
```

Workspace packages use the `@feliz/*` scope and can be imported through npm workspace links as their implementations are added.

Without Photon credentials, `npm run dev` and `npm run start` print a setup reminder and exit. With valid credentials and iMessage enabled in the Photon project, the bot initializes iMessage and echoes incoming text messages. Agent logic is not implemented yet. Embeddings use `GEMINI_API_KEY` and `gemini-embedding-001`.

## Legal corpus (`apps/ingest` → Supabase `legal_chunks`)

Follows the [Supabase contract on the webscraper branch](https://github.com/halasgraden/feliz-trojanhacks/blob/webscraper/feliz/docs/rag-supabase.md). See [the local RAG handoff](docs/local-rag.md) for setup and agent integration.

1. Use the team's existing `legal_sources` / `legal_chunks` schema with `vector(768)`. No new migration is required for this embedding switch.
2. Embeddings use `gemini-embedding-001` (`GEMINI_API_KEY`). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` for database upload.
3. `npm run ingest -w @feliz/ingest -- --dry-run` to review the chunks, then without `--dry-run` to load.
   Reads `apps/ingest/webscraper/data/processed/documents.jsonl` by default; pass a path to use another file.
   Unchanged pages are skipped only when their content hash, chunk count and embedding model match; `--force` re-embeds everything.
   `--no-embed` skips local inference (embeddings stay null and retrieval uses lexical matching);
   `--only=<url part>` loads a subset.

What the loader does to each scraped page:

- Removes site navigation and footers, and repairs mojibake (`â` → quote or dash) left by the scraper.
- Splits the flat text into ~700-character sections headed by the page's own questions; text far from
  any question heading falls back to the page title rather than a wrong `Section:`.
- Tags `city`, `county`, `state` and `topics` from `PAGE_TAGS` in `apps/ingest/src/sources.ts`.
  A page with no entry is refused, so a new scrape needs tags before it loads.
- Drops sentences listed in `OUTDATED_SENTENCES` (e.g. LAFLA's "5 days to answer" an eviction,
  superseded by AB 2347's 10 court days).
- Embeds `heading\nbody` with `gemini-embedding-001` at 768 dimensions (`RETRIEVAL_DOCUMENT` for passages, `RETRIEVAL_QUERY` for questions) and upserts on `{document_id}_{index}`. Re-run ingest after this switch so stored E5 vectors are replaced.

## Local RAG: ready for agent integration

See [the local RAG handoff](docs/local-rag.md) for the API and scope/citation rules.

```sh
npm run build
npm test
npm run rag:check  # real local CPU embeddings of all 52 scraped pages, no DB or API keys
npm run rag:query -- "When must my security deposit be returned?"
```

The model downloads once and is reused. `retrieve()` returns evidence passages and citations;
the agent teammate still implements answer generation, urgency, and conversation state.
Use a short current query, not the full transcript (512-token model limit).
