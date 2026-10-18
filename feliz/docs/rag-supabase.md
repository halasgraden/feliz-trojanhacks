# Feliz RAG and Supabase contract

This is the contract for loading scraped housing pages into Supabase and serving them to the Feliz agent. The agent already calls this shape. A new retrieval backend has to keep it.

The schema to implement is `feliz/supabase/migrations/20261017000000_agent_corpus.sql`. The TypeScript names are in `feliz/packages/db/src/types.ts`. The store that talks to Supabase is `createSupabaseStore` in `feliz/packages/db/src/supabase.ts`.

`supabase/schema.sql` at the repo root is an earlier sketch (`legal_sources`, uuid cases). The running agent does not read or write those tables.

## Two stores, two jobs

Legal answers come only from `legal_chunks`. Those rows are shared. Any authenticated user can read them. The bot writes them with the service role.

A renter's own uploads and chat live in `case_files` and `case_chunks`. The agent uses those rows to propose facts ("the move-out date in this photo looks like September 1"). It never cites them as law. A referral in `housing_resources` is a place to get help. It is never a source line.

## Scraper input

Kept pages are JSONL on the `webscraper` branch:

`feliz/apps/ingest/webscraper/data/processed/documents.jsonl`

One JSON object per line. `feliz/apps/ingest/webscraper/document_schema.py` builds each object.

| Field | Type | Meaning |
|---|---|---|
| `document_id` | string | SHA-256 hex of the canonical URL. Stable across recrawls of the same URL. |
| `title` | string | Page title. Falls back to the canonical URL. |
| `source_url` | string | Canonical URL. Scheme and host are lowercased. The fragment is removed. |
| `source_name` | string | Publisher name from `data/sources.csv`, such as `LA County Department of Consumer and Business Affairs`. |
| `content_type` | string | `html` for this corpus. |
| `text` | string | Page text. Whitespace is already collapsed to single spaces. There are no blank lines and no markdown headings. |
| `content_hash` | string | SHA-256 hex of the whitespace-normalized text. Changes when the page text changes. |
| `last_fetched_at` | string | ISO-8601 timestamp in UTC, from the machine that scraped the page. |
| `metadata` | object | Today this is `{ "extractor": "feliz-webscraper" }`. |

`content_type`, `content_hash`, and `metadata` are not columns on `legal_chunks`. Use `content_hash` in the loader to skip a document whose text has not changed. Do not embed it into the chunk body.

The file currently has these 16 pages:

- `https://dcba.lacounty.gov/rentstabilizationprogram/`
- `https://dcba.lacounty.gov/news/understanding-rent-increases/`
- `https://dcba.lacounty.gov/pricegouging/`
- `https://dcba.lacounty.gov/after-the-disaster-information-for-landlords-and-tenants/`
- `https://dcba.lacounty.gov/rentregistry/`
- `https://dcba.lacounty.gov/mediation/`
- `https://dcba.lacounty.gov/legal-access-centers/`
- `https://lafla.org/get-help/tenant-harassment/`
- `https://lafla.org/get-help/housing-and-eviction/`
- `https://lafla.org/get-help/housing-homelessness/`
- `https://lafla.org/get-help/veterans/`
- `https://lafla.org/who-we-are/locations/`
- `https://www.stayhousedla.org/`
- `https://www.lawhelpca.org/issues/housing`
- `https://www.lawhelpca.org/resource/new-california-law-requires-landlords-to-provide-working-fridge-and-stove-in-all-apartments`
- `https://www.lawhelpca.org/resource/tenant-background-checks-and-your-rights`

Load these. Do not load the pages removed from that file. Two of the removed LawHelpCA pages still say a tenant has 5 business days to answer an eviction. The housing index that remains says the deadline is 10 court days as of January 1, 2025.

## What the agent stores and retrieves

`legal_chunks` is the only legal corpus the agent searches.

| Column | TypeScript | Required for a citation |
|---|---|---|
| `id` | `id` | Yes. Chunk identity. The agent also uses it in the developer trace. |
| `document_id` | `documentId` | Yes. Groups chunks from one scraped page. |
| `publisher` | `publisher` | Yes. Copied into the source line. |
| `title` | `title` | Yes. Copied into the source line, inside quotes. |
| `url` | `url` | Yes. Copied into the source line. One token, no spaces. |
| `fetched_at` | `fetchedAt` | Yes. A date, `YYYY-MM-DD`. The source line prints this after the word `fetched`. |
| `heading` | `heading` | Yes. Printed after `Section:`. |
| `body` | `body` | Yes. This is the only text the model may treat as the law. |
| `state` | `state` | Stored. The current ranker does not filter on it. |
| `county` | `county` | Stored. The current ranker does not filter on it. |
| `city` | `city` | Filter. `null` means the chunk is eligible for every renter city. A non-null city is eligible only when it equals the renter's confirmed city. |
| `topics` | `topics` | Filter. Empty array means the chunk is eligible for every case category. Otherwise the array must include the case category. |
| `embedding` | `embedding` | Optional. `vector(768)` from `gemini-embedding-001`. Null is allowed. Retrieval still works on words alone. |

Map a JSONL row onto chunks like this:

| JSONL | Chunk |
|---|---|
| `document_id` | `document_id`, and the prefix of `id` |
| `source_name` | `publisher` |
| `title` | `title`, and the fallback `heading` when the page has no section title |
| `source_url` | `url` |
| `last_fetched_at` | `fetched_at`, the first 10 characters (`YYYY-MM-DD`) |
| `text` | split into `body` values |

Chunk ids already used by the loader in `feliz/apps/ingest/src/chunker.ts` are `{documentId}_{index}` starting at 0. Re-ingesting the same page should upsert those ids, not create a second copy.

`insertLegalChunk` writes the embedding as a pgvector literal string, `[0.1,0.2,...]`, or null. The read path accepts a JSON array or that same string.

### Chunk the flat text on purpose

`chunkText` splits on blank lines and markdown headings (`#`, `##`, `###`). Scraped `text` has neither, so that function returns one chunk whose heading is `Document` and whose body is the entire page.

Give each chunk a real heading and a body short enough to quote. About 700 characters is what `chunkText` aims for when the source has paragraphs. The heading is part of the citation, so use the section the sentences actually belong to. If the page has no sections, use the page title.

The ranker scores `heading + body + title` as one bag of words. Put the rule in `body`. A heading that repeats the rule helps the lexical match. A heading that is only "Document" does not.

### Jurisdiction and topic tags

The JSONL has no city, county, or topic. The loader has to set them.

Use these topic strings and no others. They are the case categories the agent searches with:

- `security_deposit`
- `eviction`
- `rent_increase`

Leave `topics` empty only when the page genuinely applies to every category. An empty array matches all categories. A wrong tag hides the page from the category that needs it.

`city` has the same shape of trap. `null` matches every confirmed city. `Los Angeles` matches only a renter whose confirmed city is Los Angeles. Santa Monica is a separate city in the same county. County is not a search filter today. A Los Angeles County page that is not city-specific should keep `city` null and may set `county` to `Los Angeles` and `state` to `CA` for later use.

Known city-to-county pairs in the agent are Los Angeles to Los Angeles County, and Santa Monica to Los Angeles County.

### Embedding

`feliz/packages/db/src/types.ts` fixes the models:

- Chat and transcription: `gemini-3.8-flash`
- Embeddings: `gemini-embedding-001`, `outputDimensionality` 768

Embed the heading and body together, the same string the loader embeds: `heading`, newline, `body`. Store that vector on the chunk. At query time the agent embeds the renter's transcript and passes it into the ranker. A missing query embedding, or a chunk with a null embedding, drops that chunk's vector score to 0. The word score still applies.

There is a GIN index on `topics` and a GIN index on `to_tsvector('english', body)`. There is no vector index and no `match_legal_chunks` function. The current read path is:

1. `legalChunks` asks PostgREST for at most 40 rows.
2. The filter token is the longest `[a-z0-9]{4,}` token in the query. The request is `body=ilike.*{token}*`.
3. When the renter has a city, the request also requires `city is null OR city = that city`.
4. `rankLegalChunks` in `feliz/packages/rag/src/hybrid-search.ts` ranks those candidates in process.

A replacement search has to keep feeding `rankLegalChunks`, or replace that function and `runLegalSearch` together. The agent does not call a Supabase RPC itself.

Ranker rules the results must survive:

- Drop a chunk whose `city` is set and different from the renter's city.
- Drop a chunk whose `topics` is non-empty and does not include the case category.
- Lexical score is the count of query tokens (length at least 3) that appear in `heading + body + title`, divided by the number of query tokens. A score of 0 drops the chunk, even when the embedding is close.
- Vector score is cosine similarity. It is added as `lexical + cosine * 0.01`. Words dominate. The embedding only breaks ties among chunks that already share words.
- Return at most 3 chunks.
- If the category filter returns nothing, `runLegalSearch` runs the same query again with `topic: null`.

`retrieval` on the trace is `hybrid` when the query was embedded and at least one returned chunk has an embedding. Otherwise it is `lexical`.

## How a turn uses the documents

`handleTurn` in `feliz/packages/agent/src/agent.ts` does the following.

1. Save the renter's message as a `case_events` row and as a `case_chunks` row with `corpus = 'chat'`.
2. Read the user side of the transcript. Classify it. Check urgency. Extract facts.
3. If required facts are still missing, ask at most two questions and stop. This turn does not search `legal_chunks` and does not cite anything.
4. When the facts are complete, call the model with two tools: `search_documents` and `get_document`.
5. Validate the draft against the chunks returned on this turn. A failed draft is replaced by a quotation of those chunks, or by the exact sentence `The stored housing documents do not cover this.`
6. Append referral links from `housing_resources` when the renter's city or county and the dispute match.
7. Save the assistant message, update the case, and write a `traces` row. The trace is for developers. It must not appear in the reply.

The model is `GeminiModel` (`gemini-3.8-flash`) when an API key is set. `GroundedModel` skips the model and quotes the top chunks directly. If the Gemini call throws, the agent does the same quotation fallback.

Tool definitions are in `feliz/packages/agent/src/schemas.ts`.

`search_documents` takes `query`. The agent also applies the case city and category, which the model does not get to override. The tool result the model sees is:

```json
{
  "queries": [{ "query": "...", "city": "Los Angeles", "topic": "security_deposit", "hitIds": ["..."] }],
  "chunks": [{ "id": "...", "publisher": "...", "title": "...", "url": "...", "fetchedAt": "YYYY-MM-DD", "heading": "...", "body": "..." }]
}
```

`get_document` takes `chunkId`. It returns that same chunk object, or an error. An id that is not in `legal_chunks` returns `That id is not in the legal documents.` A chunk whose `city` is set to a different city than the renter's returns `That document is outside this city's records.`

The model may call tools for up to four rounds. If it writes an answer before any search, the agent forces one `search_documents` call with the transcript and continues.

### Source line

Every legal sentence must be followed by one source line. The prompt requires this exact form:

```text
Source: PUBLISHER, "TITLE", URL, fetched YYYY-MM-DD. Section: HEADING.
```

`sourceLine` in `feliz/packages/rag/src/citations.ts` builds it from the chunk. `citationsInReply` parses it with:

```text
^Source: (.+?), "(.+?)", (\S+), fetched (\d{4}-\d{2}-\d{2})\. Section: (.+)\.$
```

Publisher, title, URL, fetch date, and heading must match the chunk character for character. A title that contains a double quote, or a URL that contains a space, will not parse. A source line that does not match a chunk retrieved on this turn fails validation, and the whole draft is discarded.

The fallback quotation looks like this:

```text
From the stored documents

- After a tenant moves out, the landlord has 21 days to return the security deposit or to send an itemized statement of deductions.
  Source: Los Angeles Housing Department, "Security deposit returns", https://housing.lacity.gov/residents/security-deposits, fetched 2026-10-17. Section: Return deadline.
```

That sample chunk is `DEPOSIT_CHUNK` in `feliz/packages/agent/src/eval.ts`. It is a fixture, not a row in the scraped file. The LAHD security-deposit page was a seed URL and did not make it into `documents.jsonl`. Until a real page states the rule, the agent has nothing to cite for it.

### What validation allows the reply to say

`validateReply` in `feliz/packages/agent/src/validate.ts` rejects a draft when:

- It matches `you will win`, `guaranteed`, `broke the law`, or `definitely entitled`.
- Any line that starts with `Source:` fails the citation match above.
- A dollar amount (`$800`) or a day count (`21 days`) appears in the reply and is not in the body of a cited chunk and not in a confirmed numeric fact (`amountWithheld`, `depositAmount`).

The system prompt also tells the model to answer only from chunks returned on this turn, to avoid inventing dollar amounts, day counts, or dates, and to say exactly `The stored housing documents do not cover this.` when the chunks do not contain the answer.

Numbers inside the referral block are not special-cased. Keep phone numbers and dates out of chunk bodies unless they are rules the agent is allowed to repeat. A day count in an uncited part of the reply fails the turn.

The reply the renter sees always starts with:

```text
This is legal information and navigation, not legal advice or representation.
```

If the transcript describes a lockout, a utility shutoff, an eviction notice, or a court date, this line is inserted before the answer:

```text
This sounds time-sensitive. If you are locked out or without utilities, contact local eviction help before spending time on a written dispute.
```

Urgency does not change which chunks are retrieved.

## What the agent needs before it will search

The agent classifies the whole user transcript, eviction first, then rent increase, then anything containing "deposit", then `other`, then `unknown` for an empty transcript.

It will not search until the required facts for that category are filled.

| Category | Facts required before search |
|---|---|
| `unknown` | Never searches. Always asks what happened. |
| `other` | Never searches. Always asks what happened. |
| `eviction` | `city` |
| `rent_increase` | `city` |
| `security_deposit` | `city`, `moveOutDate`, `itemizedStatement`, `amountWithheld` |

`whatHappened` is not a stored fact. It stays missing for `unknown` and `other`, which is why those categories never reach retrieval.

The questions, from `feliz/packages/routing/src/rules.ts`:

- `whatHappened`: "What happened with the landlord? A security deposit, an eviction notice, or a rent increase leads to different next steps."
- `city`: "Which city is the rental in?"
- `moveOutDate`: "What date did you move out and return the unit?"
- `itemizedStatement`: "Did the landlord give you a written itemized list of deductions?"
- `amountWithheld`: "How much of the deposit is still being held?"

At most two of those prompts are shown on a turn. Confirmations of a fact proposed from an upload count toward the two.

`noticeDate` and `depositAmount` are extracted when the renter states them. They are not required, and the agent does not ask for them. `county` is filled from the city when the city is Los Angeles or Santa Monica.

Facts extracted from the renter's own words:

- `amountWithheld` from "kept/withheld/holding/took/deducted $N"
- `depositAmount` from "deposit was/of/is $N" or "security deposit of $N"
- `itemizedStatement` `no` or `yes` from a short list of phrases about an itemized list
- `city` from "Los Angeles" or "Santa Monica", or a capitalized "in City" phrase
- `moveOutDate` when the message has a date and says they moved out, left the unit, or returned the keys
- `noticeDate` when the message has a date and the word "notice"

Dates are stored as `YYYY-MM-DD`.

An uploaded file can propose one of the required fields. The agent asks "From the file {filename}: the {label} looks like {value}. Is that right?" Yes writes the fact. No rejects that field for that file chunk and will not propose it from the same chunk again. Uploads are `case_chunks` with `corpus = 'case_file'`. They are not legal chunks.

## Tables the backend has to serve

The migration creates these tables. The bot uses the service role for every call. Authenticated policies exist so a logged-in user can read the shared corpus and their own case. `traces` has no authenticated policy.

`accounts`: `id` text pk, `auth_user_id` uuid unique, `phone` text unique, `created_at`. The store upserts on `phone`.

`cases`: `id` text pk, `account_id` fk, `category` text, `facts` jsonb, `pending` jsonb, `rejected` jsonb, `asked` text[], `missing` text[], `created_at`, `updated_at`. `facts` holds the `CaseFacts` object. `pending` holds proposed facts waiting for a yes. `missing` holds the requirement names that are still empty. Reads and writes are scoped with `id` and `account_id` together.

`legal_chunks`: columns in the table above. Readable by `authenticated`. Writes are service-role only.

`case_files`: `id`, `case_id`, `account_id`, `filename`, `media_type`, `extracted_text`. Private to the account.

`case_chunks`: `id`, `case_id`, `account_id`, `corpus` (`case_file` or `chat`), `source_label`, `body`, `file_id` nullable, `embedding vector(768)` nullable. Private to the account. The agent reads these by `case_id` and `account_id`. It does not hybrid-rank them.

`case_events`: `id`, `case_id`, `account_id`, `role` (`user` or `assistant`), `body`, `created_at`. Ordered by `created_at` ascending. Private to the account.

`traces`: `id`, `case_id`, `account_id`, `created_at`, `payload` jsonb. The payload records facts before and after, missing fields, urgency, file searches, legal searches, dropped draft text, chunk ids, the retrieved publisher/title/url/body, the model id, `lexical` or `hybrid`, and validation problems. Developer-only.

`housing_resources`: `id`, `name`, `url`, `state`, `county`, `city`, `disputes` text[], `notes`. Seeded with LAHD, DCBA, Stay Housed LA, and LAFLA. A referral is included when its city and county are either null or equal to the renter's, the renter has a city or a county, and `disputes` contains the category. For `unknown` and `other`, any geographically matching referral is included. The reply prints the name, URL, and notes under "Where to get help", labeled "Referral only."

## Loader checklist

1. Read the 16 JSONL lines from the `webscraper` branch.
2. Skip a document whose `content_hash` matches the hash already loaded for that `document_id`.
3. Split `text` into sections with real headings. Do not rely on blank lines being present.
4. Set `publisher` from `source_name`, `fetched_at` from the date portion of `last_fetched_at`, and `url` from `source_url`.
5. Set `city` null unless the page is a single city's rule. Set `topics` to the categories the page can answer.
6. Embed `heading\nbody` with `gemini-embedding-001` at 768 dimensions.
7. Upsert `legal_chunks` on `id = {document_id}_{index}` through the service role.
8. Leave `housing_resources` as the referral directory. Do not copy those rows into `legal_chunks` and do not cite them as law.
