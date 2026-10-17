// Load the scraper's chunks.jsonl into Supabase.
//   npm run ingest -w @feliz/ingest -- /abs/path/chunks.jsonl [--replace]
// --replace first deletes every passage from the sources in the file.
import { readFile } from "node:fs/promises";
import { ingestChunks, parseChunks } from "./ingest.js";

export { ingestChunks, parseChunks } from "./ingest.js";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: ingest <chunks.jsonl> [--replace]");
  try { process.loadEnvFile("../../.env"); } catch { /* env may come from the shell */ }

  const chunks = parseChunks(await readFile(file, "utf8"));
  console.log(`${chunks.length} chunks from ${file}`);
  const n = await ingestChunks(chunks, {
    replace: args.includes("--replace"),
    onProgress: (done, total) => process.stdout.write(`\r  embedded ${done}/${total}`),
  });
  console.log(`\nupserted ${n} passages`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
