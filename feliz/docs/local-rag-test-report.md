# Local RAG verification

Verified with real quantized `Xenova/multilingual-e5-base` on CPU, 768 dimensions, using the 52-page JSONL from `webscraper@73acb59`.

- Build and typecheck passed.
- 24 unit/integration tests passed (local inference and database writes mocked in unit tests).
- Separately ran real inference over every scraped page: 52 documents, 514 normalized vectors, approximately 10.9 seconds after loading/downloading weights.
- 116 chunks from flattened PDFs were marked for review and excluded from default retrieval.
- Four real retrieval smoke checks passed: English security-deposit return, eviction response, rent increases, and Spanish security-deposit question. Each found an expected relevant source in the top five passages.
- Verified a second query with `FELIZ_MODEL_OFFLINE=1` against the default model cache, proving the query path works without model-network access.
- Scope tests cover city mismatch, unknown location, unincorporated county scope, topic filters, held content, and foreign-model vectors. Citation tests reject unreturned sources. Ingestion tests verify null/foreign-model vectors are regenerated even when text is unchanged.

Run `npm run rag:check` for the complete real-inference smoke check. Its machine-readable report is `.data/local-rag-check.json`; the ready-to-query local corpus is `.data/legal-chunks.e5.jsonl` (both ignored). Run `npm test` for automated regression checks.

These are retrieval checks, not a comprehensive evaluation of legal accuracy or generated answers. The agent workflow and Photon message loop are separate work. No API credits were spent. Live Supabase verification was subsequently completed with the team's existing backend credentials, as recorded below.

## Live shared database verification

Loaded the previously empty team corpus successfully: 52 legal_sources rows and 514 legal_chunks rows. Every stored vector has 768 dimensions and embedding_model Xenova/multilingual-e5-base. Verified database-backed hybrid retrieval returns the Courts/DCBA security-deposit sources; review/resource/unincorporated-only holds were honored. No schema changes or paid model API calls were made. Machine-readable results: .data/supabase-rag-check.json.
