import { readFile } from "node:fs/promises";
import { retrieve, sourceLine, EMBEDDING_MODEL } from "../packages/rag/dist/index.js";
const query = process.argv.slice(2).join(" ").trim();
if (!query) throw new Error('Usage: npm run rag:query -- "My landlord kept my deposit"');
const chunks = (await readFile(".data/legal-chunks.jsonl", "utf8")).split("\n").filter(Boolean).map(JSON.parse);
if (chunks.some((c) => c.embeddingModel !== EMBEDDING_MODEL)) throw new Error("Rebuild the index with npm run rag:check");
const result = await retrieve(query, { chunks, state: "CA", county: "Los Angeles", city: "Los Angeles" });
for (const c of result.chunks) console.log(`${c.body}\n${sourceLine(c)}\n`);
console.log(`Retrieval: ${result.retrieval}; ${result.chunks.length} passages. These are evidence passages, not a generated legal answer.`);
