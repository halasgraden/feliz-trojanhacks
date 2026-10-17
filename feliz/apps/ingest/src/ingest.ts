import { deleteDocumentsBySource, upsertDocuments, type ScrapedChunk } from "@feliz/db";
import { embedPassages } from "./embed.js";
import { metaFor } from "./source-meta.js";

// ~100 rows x 1536-float vectors stays well under Supabase's request size limit.
const UPSERT_BATCH = 100;

/**
 * Embed scraped chunks and store them in Supabase. Call this directly from a
 * TypeScript scraper, or via the CLI (index.ts) with a chunks.jsonl file.
 * replace: first delete every passage from the sources being ingested.
 */
export async function ingestChunks(
  chunks: ScrapedChunk[],
  { replace = false, onProgress }: { replace?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<number> {
  const vectors = await embedPassages(chunks, onProgress);
  if (replace) {
    await deleteDocumentsBySource([...new Set(chunks.map((c) => c.source))]);
  }
  const rows = chunks.map((c, i) => ({
    id: c.id,
    source: c.source,
    source_name: c.source_name ?? c.source,
    url: c.url,
    title: c.title ?? null,
    content: c.text,
    ...metaFor(c.source),
    embedding: vectors[i],
  }));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    await upsertDocuments(rows.slice(i, i + UPSERT_BATCH));
  }
  return rows.length;
}

export function parseChunks(jsonl: string): ScrapedChunk[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const c = JSON.parse(line) as ScrapedChunk;
      if (!c.id || !c.source || !c.url || !c.text) {
        throw new Error(`line ${i + 1}: chunk needs id, source, url and text`);
      }
      return c;
    });
}
