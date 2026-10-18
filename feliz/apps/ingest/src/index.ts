// Load the scraped legal corpus into Supabase legal_chunks (docs/rag-supabase.md, "Loader checklist").
//
//   npm run ingest -w @feliz/ingest                      # load webscraper/data/processed/documents.jsonl
//   npm run ingest -w @feliz/ingest -- --dry-run         # print chunks; no keys, no writes
//   npm run ingest -w @feliz/ingest -- --force           # re-embed pages whose text hasn't changed
//   npm run ingest -w @feliz/ingest -- --only=lawhelpca  # just the pages whose URL contains this
//   npm run ingest -w @feliz/ingest -- /abs/path/documents.jsonl
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  deleteStaleLegalChunks,
  loadedState,
  upsertLegalChunks,
  upsertLegalSources,
  type LegalChunk,
  type LegalSource,
} from "@feliz/db";
import { EMBEDDING_MODEL } from "@feliz/rag";
import { chunkDocument } from "./chunker.js";
import { embedChunks } from "./embed.js";
import { parseDocument, parseJsonl, type ParsedDocument } from "./parser.js";

const DEFAULT_INPUT = fileURLToPath(new URL("../webscraper/data/processed/documents.jsonl", import.meta.url));

/** The page row every chunk references (legal_chunks.document_id -> legal_sources). */
export function buildLegalSource(doc: ParsedDocument): LegalSource {
  return {
    documentId: doc.documentId,
    sourceUrl: doc.url,
    publisher: doc.publisher,
    title: doc.title,
    contentType: doc.raw.content_type || "html",
    contentHash: doc.contentHash,
    extractedText: doc.raw.text, // the scraper's text, unedited; chunks hold the cleaned text
    lastFetchedAt: doc.raw.last_fetched_at,
    metadata: { ...doc.raw.metadata, scraped_title: doc.raw.title, tags: doc.tags },
  };
}

/** Steps 3–5 of the checklist: sections with headings, field mapping, tags. No embedding yet. */
export function buildLegalChunks(doc: ParsedDocument): LegalChunk[] {
  return chunkDocument(doc).map((s, i) => ({
    id: s.id,
    documentId: doc.documentId,
    chunkIndex: i,
    publisher: doc.publisher,
    title: doc.title,
    url: doc.url,
    fetchedAt: doc.fetchedAt,
    heading: s.heading,
    body: s.body,
    state: doc.tags.state,
    county: doc.tags.county,
    city: doc.tags.city,
    topics: doc.tags.topics,
    embedding: null,
    embeddingModel: null,
  }));
}

export async function ingest(input: string, { dryRun = false, force = false, only }: { dryRun?: boolean; force?: boolean; only?: string } = {}) {
  const docs = parseJsonl(await readFile(input, "utf8"))
    .filter((d) => !only || d.source_url.includes(only))
    .map(parseDocument);
  const byDoc = docs.map((doc) => ({ doc, chunks: buildLegalChunks(doc) }));

  if (dryRun) {
    for (const { doc, chunks } of byDoc) {
      console.log(`\n# ${doc.title}  [${doc.tags.topics.join(", ") || "all topics"}; city ${doc.tags.city ?? "any"}]`);
      console.log(`  ${doc.url}`);
      for (const c of chunks) console.log(`  ${c.id.slice(-4).replace(/^.*_/, "_")}  ${c.heading}\n        ${c.body.slice(0, 160)}${c.body.length > 160 ? "…" : ""} (${c.body.length})`);
    }
    console.log(`\n${docs.length} pages -> ${byDoc.reduce((n, d) => n + d.chunks.length, 0)} chunks (dry run; nothing written)`);
    return;
  }

  const loaded = force ? new Map() : await loadedState(docs.map((d) => d.documentId));
  let written = 0;
  for (const { doc, chunks } of byDoc) {
    const prev = loaded.get(doc.documentId);
    if (prev && prev.contentHash === doc.contentHash && prev.chunkCount === chunks.length) {
      console.log(`  unchanged  ${doc.url}`);
      continue;
    }
    // Embed before writing anything, so a Gemini failure leaves the database untouched.
    const vectors = await embedChunks(chunks);
    chunks.forEach((c, i) => {
      c.embedding = vectors[i];
      c.embeddingModel = EMBEDDING_MODEL;
    });
    await upsertLegalSources([buildLegalSource(doc)]); // the page row must exist before its chunks
    await upsertLegalChunks(chunks);
    await deleteStaleLegalChunks(doc.documentId, chunks.map((c) => c.id));
    written += chunks.length;
    console.log(`  loaded ${String(chunks.length).padStart(3)}  ${doc.url}`);
  }
  console.log(`\nwrote ${written} chunks from ${docs.length} pages`);
}

async function main() {
  const args = process.argv.slice(2);
  try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); } catch { /* env may come from the shell */ }
  await ingest(args.find((a) => !a.startsWith("--")) ?? DEFAULT_INPUT, {
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    only: args.find((a) => a.startsWith("--only="))?.slice("--only=".length),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
