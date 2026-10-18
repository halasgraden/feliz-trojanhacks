# Feliz (Renter's Resource Guide)

TypeScript monorepo shell for a tenant rights and housing resource navigator. Photon Spectrum connects the bot to iMessage; the bot currently echoes text while agent and data integrations remain placeholders.

## Requirements

Node.js 22 or newer and npm.

## Install

```sh
npm install
```

Copy `.env.example` to `.env` and fill in `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` from your Photon project settings. The bot loads this file automatically. Photon uses these two credentials for the [stable Spectrum SDK](https://photon.codes/docs/spectrum-ts/getting-started); `PHOTON_API_KEY` is not used by this SDK.

The bot connects to the iMessage line enabled in your Photon project. On Photon's shared line, add your phone under Users before testing. See Photon's [provider guide](https://photon.codes/docs/spectrum-ts/providers).

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
npm run dev        # build and initialize Photon messaging when configured
npm run start      # build and start the bot
npm run build      # compile all workspaces
npm run typecheck  # check all workspaces
npm test           # run Vitest
```

Workspace packages use the `@feliz/*` scope and can be imported through npm workspace links as their implementations are added.

Without Photon credentials, `npm run dev` and `npm run start` print a setup reminder and exit. With valid credentials and iMessage enabled in the Photon project, the bot initializes iMessage and echoes incoming text messages. Agent logic is not implemented yet.
