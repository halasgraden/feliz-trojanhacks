# Feliz — housing dispute navigator

A Photon agent that helps a renter sort a **California security-deposit** problem, ask for the missing facts, and answer only from a small set of California Courts Self-Help sources.

Eviction notices and rent increases are recognized. The agent routes urgent cases and refuses to invent rules it does not have.

This is legal information and navigation, not legal advice or representation.

## Test the agent

```powershell
npm test
npm run agent -- talk --message "My landlord kept $800 of my security deposit and won't explain why."
npm run agent -- show
npm run agent -- evaluate
```

`talk` keeps the case in `.data/housing-navigator-session.json`. `reset` starts over. In PowerShell, wrap the message in single quotes so `$800` is passed through as text.

`npm run agent` loads `housing-navigator.photon.ts` through Photon's compiler and calls the class directly. Photon's own CLI (`npm run photon -- cli housing-navigator talk ...`) and Beam (`npm run beam`) need the Photon daemon. On Windows that daemon fails in Photon 1.37.0 and 1.38.0: it tries to write an owner file at `\\.\pipe\daemon.owner.json`. Use `npm run agent` on this machine. The CLI path is there for a teammate on macOS or Linux, where the daemon socket is a normal file.

## Gemini

Language understanding uses Gemini when a key is set. Legal deadlines and citations still come from `src/knowledge.mjs`.

```powershell
$env:HOUSING_NAVIGATOR_GEMINI_API_KEY="your-key"
npm run agent -- talk --message "My landlord kept $800 of my security deposit and won't explain why."
```

Photon 1.37.0 maps that constructor argument from the photon name `housing-navigator`. With no key, the deterministic navigator runs and the scenarios stay reproducible.

## What is stored

The running MVP keeps the active case in Photon's `@stateful` store (`.data/`). `supabase/schema.sql` is the later system of record for sources, resources, cases, and conversation events. It is not required to test the agent.
