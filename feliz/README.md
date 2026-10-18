# Feliz (Renter's Resource Guide)

TypeScript monorepo for a tenant rights and housing resource navigator. Gemini embeddings, corpus ingestion, Supabase data access, and retrieval are implemented. The agent asks for missing facts, calls `retrieve()` with the confirmed state, county, city, topic, and unincorporated flag, then checks citations before Photon sends the reply.

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
- `packages/agent`: conversation turn, citation check, and Gemini answer loop
- `packages/rag`: Gemini embeddings, scoped hybrid retrieval and source citations
- `packages/routing`: issue category, required facts, and urgency
- `packages/db`: server-side Supabase corpus reads and writes, plus case storage
- `supabase/`: corpus and case migration
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

Without Photon credentials, `npm run dev` and `npm run start` load the agent and print a setup reminder. With valid credentials and iMessage enabled in the Photon project, each text message is one agent turn. `GOOGLE_APPLICATION_CREDENTIALS` points at a Google Cloud service-account JSON. Vertex uses that file to embed passages and questions with `gemini-embedding-001` and to draft the reply. Leave it unset and search uses keywords only.

Apply `supabase/migrations/20261018000000_corpus_and_cases.sql` before the first ingest. `legal_sources.metadata.tags` must be an object or retrieval holds the page out. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for a shared corpus. Without them the bot keeps cases in memory and has nothing to cite until chunks are inserted.

## Legal corpus (`apps/ingest` → Supabase `legal_chunks`)

Follows the [Supabase contract on the webscraper branch](https://github.com/halasgraden/feliz-trojanhacks/blob/webscraper/feliz/docs/rag-supabase.md). See [the local RAG handoff](docs/local-rag.md) for setup and agent integration.

1. Use the team's existing `legal_sources` / `legal_chunks` schema with `vector(768)`. No new migration is required for this embedding switch.
2. Embeddings use `gemini-embedding-001` through the service account in `GOOGLE_APPLICATION_CREDENTIALS`. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` for database upload.
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
npm run rag:check  # real Gemini embeddings of all 52 scraped pages (needs credentials), no DB writes
npm run rag:query -- "When must my security deposit be returned?"
```

Embeddings need `GOOGLE_APPLICATION_CREDENTIALS` (service account key file path)
in `feliz/.env`; see docs/local-rag.md. `retrieve()` returns evidence passages and citations.
The agent calls it with a short query; a longer question keeps its newest ~2,048 tokens.
