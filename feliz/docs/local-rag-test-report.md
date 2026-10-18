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

## Review fixes (2026-10-18)

- **Long questions:** the 512-token check never ran (the tokenizer returns a flat id array; the code read `ids[0].length`), so the model silently kept only the first 512 tokens. Two long conversations differing only in their last line ("I was locked out" vs. "my cat likes tuna") produced identical embeddings. Fixed: questions keep their end and report `queryTruncated`; oversized passages are refused. The test mock now returns the real flat shape; reintroducing the bug fails 3 tests.
- **Place names** are compared case- and space-insensitively; previously `"los angeles"` silently dropped all City of Los Angeles passages.
- **Corpus cache:** live Supabase search measured 4.2 s for the first call and 15 ms for the next.
- **Embedding failure** now falls back to keyword search with a warning instead of failing the turn.
- **Relevance (advisory):** no similarity cutoff on passages separated on-topic from off-topic questions (Spanish renter questions scored 0.78-0.79, off-topic English up to 0.81). Similarity to example renter questions does better: held-out 13/15 renter questions `strong`, 11/12 non-housing `weak`. Advisory only.
- `npm run rag:check` now also verifies: newest message still affects a long query, lowercase city finds City of LA rules, an off-topic question is flagged weak. All 7 checks pass. Unit tests: 30 pass.
- Live Supabase `retrieve()` (read-only): English deposit question returns the Courts and DCBA 21-day passages first, with valid Source lines; a Spanish eviction-response question returns the right Courts pages but not the 10-day passage in the top 5 (base-model cross-language limit, documented in local-rag.md).

## Gemini embeddings via service account (2026-10-18)

- Embeddings switched to `gemini-embedding-001` (768, normalized). Added a Vertex AI service-account route (`GOOGLE_APPLICATION_CREDENTIALS`), since the available Gemini API key had no prepaid credit. Sign-in is shared across concurrent requests (a test caught three parallel sign-ins); 429/5xx are retried.
- Re-ran ingest against the live Supabase corpus: 52 sources, **514 chunks, all `gemini-embedding-001`, all 768-wide unit vectors**, none left from E5. A second run skipped all 52 pages.
- Keyword matching now uses whole words. Substring matching let Spanish "para"/"una" match "paragraph"/"unable", which dropped the eviction-deadline passage from #2 to #10 for a Spanish question.
- Live `retrieve()` checks, rule's rank in the top 5: English deposit → 21 days at #1; English eviction response → 10 days at #3; two Spanish eviction-deadline questions → #2 and #1; Spanish deposit → #1.
- Relevance cutoffs re-measured for Gemini (topic ≥ 0.66 or passage ≥ 0.65): 18/18 and 14/14 on the tuning set, **15/15 and 12/12 on the held-out set**.
- `npm run rag:check`: 7/7 pass with Gemini. Unit tests: 31 pass.
