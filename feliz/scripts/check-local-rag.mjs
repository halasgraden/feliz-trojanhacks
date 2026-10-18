import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseJsonl, parseDocument } from "../apps/ingest/dist/parser.js";
import { buildLegalChunks } from "../apps/ingest/dist/index.js";
import { embedDocuments, chunkEmbeddingText, EMBEDDING_MODEL, retrieve, sourceLine } from "../packages/rag/dist/index.js";
const input = process.argv[2] || fileURLToPath(new URL("../apps/ingest/webscraper/data/processed/documents.jsonl", import.meta.url));
const raw = await readFile(input, "utf8");
const docs = parseJsonl(raw).map(parseDocument);
const chunks = docs.flatMap(buildLegalChunks);
console.log(`Parsed ${docs.length} pages into ${chunks.length} chunks. Embedding locally on CPU...`);
const started = Date.now();
const vectors = await embedDocuments(chunks.map(chunkEmbeddingText), { onProgress: (n, total) => { if (n % 40 === 0 || n === total) console.log(`Embedded ${n}/${total}`); } });
chunks.forEach((chunk, i) => { chunk.embedding = vectors[i]; chunk.embeddingModel = EMBEDDING_MODEL; });
await mkdir(".data", { recursive: true });
await writeFile(".data/legal-chunks.e5.jsonl", chunks.map((c) => JSON.stringify(c)).join("\n") + "\n");
const scenarios = [
  { query: "My landlord is keeping my security deposit. When do they have to return it?", topic: "security_deposit", expected: /guide-security-deposits-california|security-deposits-2/ },
  { query: "I was served eviction court papers. How do I file an answer?", topic: "eviction", expected: /eviction-tenant\/(respond|summons)|eviction-tenant$/ },
  { query: "How much can my landlord increase my rent?", topic: "rent_increase", expected: /rent-increases|renter-protections|under-the-rso/ },
  { query: "Mi arrendador no me devuelve el deposito de seguridad. Que puedo hacer?", topic: "security_deposit", expected: /guide-security-deposits-california|security-deposits-2/ },
];
const results = [];
for (const scenario of scenarios) {
  const result = await retrieve(scenario.query, { chunks, state: "CA", county: "Los Angeles", city: "Los Angeles", topic: scenario.topic });
  const pass = result.chunks.some((c) => scenario.expected.test(c.url));
  results.push({ query: scenario.query, pass, hits: result.chunks.map((c) => ({ id: c.id, url: c.url, heading: c.heading, score: c.score, similarity: c.similarity, citation: sourceLine(c) })) });
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario.query}\n  ${result.chunks.map((c) => c.url).join("\n  ")}`);
}
const report = { model: EMBEDDING_MODEL, dimensions: 768, corpusSha256: createHash("sha256").update(raw).digest("hex"), pages: docs.length, chunks: chunks.length, reviewHeldChunks: chunks.filter((c) => c.reviewRequired).length, seconds: (Date.now() - started) / 1000, results };
await writeFile(".data/local-rag-check.json", JSON.stringify(report, null, 2));
console.log(`Saved .data/legal-chunks.e5.jsonl and .data/local-rag-check.json (${report.seconds}s). No API credits or database writes.`);
if (results.some((r) => !r.pass)) process.exitCode = 1;
