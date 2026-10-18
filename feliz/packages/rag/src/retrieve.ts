import { listLegalChunks, type LegalChunk } from "@feliz/db";
import { embedQuery } from "./embed.js";
import { rankLegalChunks, type SearchOptions, type RankedChunk } from "./hybrid-search.js";
export interface RetrieveOptions extends Omit<SearchOptions, "queryEmbedding"> {
  /** Preloaded corpus for a DB-free demo or a per-process cache. */
  chunks?: LegalChunk[]; lexicalOnly?: boolean;
}
export interface RetrieveResult { chunks: RankedChunk[]; retrieval: "hybrid" | "lexical"; status: "ok" | "no_evidence" }
export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
  if (!query.trim()) return { chunks: [], retrieval: "lexical", status: "no_evidence" };
  const chunks = opts.chunks ?? await listLegalChunks();
  const queryEmbedding = opts.lexicalOnly ? undefined : await embedQuery(query);
  const hits = rankLegalChunks(chunks, query, { ...opts, queryEmbedding });
  return { chunks: hits, retrieval: queryEmbedding && hits.some((c) => c.similarity !== null) ? "hybrid" : "lexical", status: hits.length ? "ok" : "no_evidence" };
}
