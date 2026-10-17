# tenant-navigator

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

Workspace packages use the `@tenant-navigator/*` scope and can be imported through npm workspace links as their implementations are added.
