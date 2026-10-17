import { getSupabase } from "./client.js";

export type Jurisdiction = "city_of_la" | "la_county" | "california";

/**
 * One line of the scraper's chunks.jsonl. This is the contract between
 * scraping and RAG: the scraper writes these, ingest embeds and stores them.
 */
export interface ScrapedChunk {
  id: string;
  source: string;
  source_name: string;
  url: string;
  title?: string | null;
  text: string;
}

export interface DocumentRow {
  id: string;
  source: string;
  source_name: string;
  url: string;
  title: string | null;
  content: string;
  jurisdictions: Jurisdiction[];
  authority: number;
  embedding: number[];
}

export interface SearchRow extends Omit<DocumentRow, "embedding"> {
  similarity: number | null;
  score: number;
}

export async function upsertDocuments(rows: DocumentRow[]): Promise<void> {
  const { error } = await getSupabase()
    .from("rag_documents")
    .upsert(
      rows.map((r) => ({ ...r, embedding: JSON.stringify(r.embedding), updated_at: new Date().toISOString() })),
      { onConflict: "id" },
    );
  if (error) throw new Error(`upsertDocuments: ${error.message}`);
}

/** Remove every passage from these sources, so pages dropped by a re-scrape disappear. */
export async function deleteDocumentsBySource(sources: string[]): Promise<void> {
  const { error } = await getSupabase().from("rag_documents").delete().in("source", sources);
  if (error) throw new Error(`deleteDocumentsBySource: ${error.message}`);
}

export async function hybridSearch(params: {
  queryText: string;
  queryEmbedding: number[];
  matchCount: number;
  jurisdictions: Jurisdiction[] | null;
}): Promise<SearchRow[]> {
  const { data, error } = await getSupabase().rpc("hybrid_search", {
    query_text: params.queryText,
    query_embedding: JSON.stringify(params.queryEmbedding),
    match_count: params.matchCount,
    filter_jurisdictions: params.jurisdictions,
  });
  if (error) throw new Error(`hybrid_search: ${error.message}`);
  return data as SearchRow[];
}
