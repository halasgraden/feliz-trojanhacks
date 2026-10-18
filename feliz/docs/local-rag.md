# Embeddings and RAG handoff

Default embedding model: `gemini-embedding-001` at 768 dimensions, L2-normalized. Passages use task type `RETRIEVAL_DOCUMENT` on `heading\nbody`. Questions use `RETRIEVAL_QUERY`. Set `GEMINI_API_KEY`. Vectors from `Xenova/multilingual-e5-base` are a different model and are not scored.

## Run the complete local check

From the repository's **feliz/** directory, preferably with Node 24 LTS:

```sh
npm ci
npm run rag:check
npm run rag:query -- "My landlord kept my security deposit"
```

`rag:check` builds the workspaces, loads the committed 52-page corpus from `webscraper@73acb59`, embeds all passages, and tests English deposit, eviction-response, rent-increase, and Spanish deposit retrieval against real source URLs. It saves:

- `.data/legal-chunks.e5.jsonl`: local corpus with vectors, citation metadata and scope flags.
- `.data/local-rag-check.json`: corpus hash, model, counts, timings and test results.

The scripts perform no Supabase writes. Both files are ignored by Git. Keep a real model run separate from unit tests (`npm test`), which mock inference and database writes. A retrieval hit is a candidate source passage, not validation of a generated legal claim.

`rag:check` calls the Gemini API, so it needs `GEMINI_API_KEY` in `feliz/.env`. The model accepts 2,048 tokens. A longer question keeps its end and sets `queryTruncated: true`. A longer passage is refused, since that means the chunker produced an oversized chunk. Passing the current question plus concise relevant facts still works best. After this model switch, run ingest again so every stored vector is `gemini-embedding-001`.

## Agent API

```ts
import { retrieve, sourceLine, citationsInReply, embedQuery } from "@feliz/rag";

const evidence = await retrieve(question, {
  state: "CA",
  county: "Los Angeles",
  city: "Los Angeles", // confirmed property location, not inferred from the user's phone
  topic: "security_deposit",
});
// evidence.chunks: body, heading, URL, publisher, fetch date, IDs, ranking scores.
// evidence.retrieval: hybrid | lexical; evidence.status: ok | no_evidence.
// evidence.relevance: strong | weak | unknown  (advisory; see "Relevance" below)
// evidence.topSimilarity, evidence.topicSimilarity: scores for traces
// evidence.queryTruncated: the question was cut to its last 512 tokens
// evidence.warnings: e.g. the model failed to load and keyword search was used instead
// Give the model only these chunks as legal evidence.
const context = evidence.chunks.map(c => `${c.body}\n${sourceLine(c)}`).join("\n\n");
// citationsInReply(finalReply, evidence.chunks) checks exact source-line membership.
```

When connecting an agent built from the earlier `webscraper` contract, replace its old `runLegalSearch` ranking call with `retrieve()` above. Query vectors and corpus vectors both come from `gemini-embedding-001`. Do not mix in stored E5 vectors. Pass the confirmed state/county/city and category on each search, and preserve the returned chunk IDs and source lines for that turn's citation validation. The old contract's 16-page count, Gemini model, 40-row keyword prefilter and city-only scope describe the earlier design; this implementation uses the committed 52-page corpus and the stricter scope rules below. `handleTurn` in `@feliz/agent` calls `retrieve()` with `state: "CA"`, the confirmed county and city, the case topic, and `unincorporated: true` only after the renter says the rental is outside any city. The question is embedded with `gemini-embedding-001`, the same model as the corpus. A `weak` relevance score is stored on the developer trace and does not drop passages. `citationsInReply` must match a chunk from this turn or the draft is replaced. Dollar amounts and day counts must appear in a cited chunk or a confirmed fact. The reply always starts with the not-legal-advice line, adds the urgency line for a lockout or eviction notice, and appends referral links. Photon sends that reply. Unit tests fake `retrieve()` so they do not download the model.

### Relevance (advisory)

`relevance` says whether the question reads like a renter's housing question. It is the best of two signals: similarity to nine example renter questions in English and Spanish (`TOPIC_EXAMPLES`, cutoff 0.86) and similarity to the best returned passage (cutoff 0.845). Similarity to legal passages alone could not separate housing from non-housing questions, and scored Spanish questions below off-topic English ones.

Measured with the real model on questions never used to choose the cutoffs: 13/15 renter questions marked `strong` and 11/12 non-housing questions marked `weak`. Misses: "keeping $1200 for repainting" and a Spanish rent-increase question were `weak`; "fired for being sick" was `strong`. Because real renter questions can be `weak`, **never block on it**: passages are always returned. Use `weak` to ask what happened, or to word the answer more cautiously. The agent's own case classification remains the gate for whether to search.

### Behavior notes

- Place names match case- and space-insensitively (`"los angeles"` = `"Los Angeles"`).
- The corpus loaded from Supabase is cached per process for 5 minutes (`cacheTtlMs`; `0` disables). Call `clearCorpusCache()` after re-running ingest. Measured: first search ~4 s (corpus + model load), cached searches ~15 ms plus query embedding.
- If the embedding model fails to load, `retrieve()` falls back to keyword search and reports it in `warnings` instead of throwing.
- The Spanish ranking note in the test report was measured on multilingual-e5-base. It does not describe `gemini-embedding-001`. Re-check it after the corpus is re-embedded.

For a DB-free demo pass `chunks` parsed from `.data/legal-chunks.e5.jsonl` to `retrieve`. Database retrieval pages through the small shared corpus, joins `legal_sources.metadata.tags`, and ranks locally with keyword/vector reciprocal rank fusion. This intentionally avoids a new Supabase search RPC. If the corpus grows, move candidate search into Postgres while preserving the public contract. The function caches DB rows for `cacheTtlMs` (default 5 minutes).

`rankLegalChunks(chunks, query, { queryEmbedding, state, county, city, topic, unincorporated, limit })` is a pure ranking API for an agent/store that already loads chunks. Only current-model vectors participate in semantic scores; old/null vectors can still match lexical terms. `lexicalOnly: true` explicitly selects keyword-only retrieval.

No location means no location-scoped passages. Statewide material is included with `state: "CA"`. County-wide material additionally requires the county, city material the exact city. County ordinances flagged `unincorporatedOnly` additionally require `unincorporated: true`. Older flattened PDFs are imported/embedded but marked `reviewRequired`; they are held out of search until currency and page references are reviewed. Resource-only pages are also held out of legal retrieval. The applicability flags live in source `metadata.tags`; they do not add columns to the team's chunk schema. If a backend supplies preloaded chunks itself, preserve these flags instead of dropping source metadata.

Citation format remains the team's contract:

```text
Source: PUBLISHER, "TITLE", URL, fetched YYYY-MM-DD. Section: HEADING.
```

`citationsInReply` verifies citation membership, not semantic support for every legal claim. The agent still needs evidence-grounded generation, missing-fact questions, urgency routing, final-answer validation and per-conversation state. No claim confidence is inferred from an embedding similarity score.

## Upload the shared Supabase corpus

The team's existing `legal_sources` / `legal_chunks` schema and `vector(768)` column are retained. A model switch requires replacing vectors, not altering their width. Supply only `SUPABASE_URL` and backend `SUPABASE_SERVICE_ROLE_KEY` in `feliz/.env`, then:

```sh
npm run build
npm run ingest -w @feliz/ingest -- --dry-run
npm run ingest -w @feliz/ingest -- --force
```

The loader writes parent source rows before referencing chunks, persists `embedding_model`, and removes stale chunks within a changed document. Null or foreign-model embeddings trigger regeneration even if the text hash is unchanged. `--force` is useful after changing cleaning/tagging rules. For a file export without any DB credentials:

```sh
npm run ingest -w @feliz/ingest -- --output=/absolute/path/index.jsonl
```

Do not serve a partly migrated corpus with mixed model vectors as if it were a consistent semantic index. Stop/refresh retrieval while replacing an existing live corpus. Documents removed from a crawl are not automatically deleted; retire them deliberately. Supabase writes are batch operations, not an atomic corpus publication. The chat model is independent and may still need its own provider/credentials; this change completes embeddings/retrieval, not the agent or Photon messaging loop.
