import { getSupabase } from "./client.js";

export type Topic = "security_deposit" | "eviction" | "rent_increase";

/** One row of legal_sources: a scraped page. Every legal_chunks row references one. */
export interface LegalSource {
  documentId: string;
  sourceUrl: string;
  publisher: string;
  title: string;
  contentType: string;
  contentHash: string;
  extractedText: string;
  lastFetchedAt: string; // ISO timestamp from the scraper
  metadata: Record<string, unknown>;
}

/** One row of legal_chunks, with the TypeScript names from docs/rag-supabase.md. */
export interface LegalChunk {
  id: string; // "{documentId}_{chunkIndex}"
  documentId: string;
  chunkIndex: number;
  publisher: string;
  title: string;
  url: string;
  fetchedAt: string; // YYYY-MM-DD
  heading: string;
  body: string;
  state: string | null;
  county: string | null;
  city: string | null; // null = every city
  topics: Topic[]; // empty = every category
  embedding: number[] | null;
  embeddingModel: string | null;
  /** Applicability flags stored in legal_sources.metadata.tags, not extra DB columns. */
  unincorporatedOnly?: boolean;
  reviewRequired?: boolean;
  resourceOnly?: boolean;
}

export const legalSourceRow = (s: LegalSource) => ({
  document_id: s.documentId,
  source_url: s.sourceUrl,
  publisher: s.publisher,
  title: s.title,
  content_type: s.contentType,
  content_hash: s.contentHash,
  extracted_text: s.extractedText,
  last_fetched_at: s.lastFetchedAt,
  metadata: s.metadata,
});

export const legalChunkRow = (c: LegalChunk) => ({
  id: c.id,
  document_id: c.documentId,
  chunk_index: c.chunkIndex,
  publisher: c.publisher,
  title: c.title,
  url: c.url,
  fetched_at: c.fetchedAt,
  heading: c.heading,
  body: c.body,
  state: c.state,
  county: c.county,
  city: c.city,
  topics: c.topics,
  // pgvector literal string, as insertLegalChunk writes it
  embedding: c.embedding ? `[${c.embedding.join(",")}]` : null,
  embedding_model: c.embeddingModel,
});

const BATCH = 100; // ~100 rows of 768-d vectors stays well under the request size limit

export async function upsertLegalSources(sources: LegalSource[]): Promise<void> {
  const { error } = await getSupabase().from("legal_sources").upsert(sources.map(legalSourceRow), { onConflict: "document_id" });
  if (error) throw new Error(`upsertLegalSources: ${error.message}`);
}

export async function upsertLegalChunks(chunks: LegalChunk[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH) {
    const { error } = await getSupabase()
      .from("legal_chunks")
      .upsert(chunks.slice(i, i + BATCH).map(legalChunkRow), { onConflict: "id" });
    if (error) throw new Error(`upsertLegalChunks: ${error.message}`);
  }
}

/** Remove a page's chunks that are no longer produced, e.g. after the page got shorter. */
export async function deleteStaleLegalChunks(documentId: string, keepIds: string[]): Promise<void> {
  let query = getSupabase().from("legal_chunks").delete().eq("document_id", documentId);
  if (keepIds.length) query = query.not("id", "in", `(${keepIds.join(",")})`);
  const { error } = await query;
  if (error) throw new Error(`deleteStaleLegalChunks: ${error.message}`);
}

/**
 * What is already stored per page: its content_hash in legal_sources and how many chunks it has.
 * A page is up to date only when both match, so a load interrupted mid-page gets redone.
 */
export async function loadedState(documentIds: string[]): Promise<Map<string, { contentHash: string; chunkCount: number; embeddingModels: (string | null)[] }>> {
  const state = new Map<string, { contentHash: string; chunkCount: number; embeddingModels: (string | null)[] }>();
  if (!documentIds.length) return state;
  const sb = getSupabase();
  const sources = await sb.from("legal_sources").select("document_id, content_hash").in("document_id", documentIds);
  if (sources.error) throw new Error(`loadedState: ${sources.error.message}`);
  for (const r of sources.data ?? []) state.set(r.document_id as string, { contentHash: r.content_hash as string, chunkCount: 0, embeddingModels: [] });
  for (let offset = 0; ; offset += 500) {
    const chunks = await sb.from("legal_chunks").select("id, document_id, embedding_model").in("document_id", documentIds).order("id").range(offset, offset + 499);
    if (chunks.error) throw new Error(`loadedState: ${chunks.error.message}`);
    for (const r of chunks.data ?? []) {
      const s = state.get(r.document_id as string);
      if (s) { s.chunkCount++; s.embeddingModels.push(r.embedding_model as string | null); }
    }
    if ((chunks.data?.length ?? 0) < 500) break;
  }
  return state;
}

/** Fetch all candidates for the small corpus, not a keyword-limited prefix of it. */
export async function listLegalChunks(): Promise<LegalChunk[]> {
  const chunks: LegalChunk[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from("legal_chunks")
      .select("*, source:legal_sources(metadata)").order("id").range(offset, offset + 499);
    if (error) throw new Error(`listLegalChunks: ${error.message}`);
    for (const row of data ?? []) {
      const tags = (row.source as any)?.metadata?.tags ?? {};
      chunks.push({
        id: row.id, documentId: row.document_id, chunkIndex: row.chunk_index, publisher: row.publisher,
        title: row.title, url: row.url, fetchedAt: row.fetched_at, heading: row.heading, body: row.body,
        state: row.state, county: row.county, city: row.city, topics: row.topics,
        embedding: typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding,
        embeddingModel: row.embedding_model, unincorporatedOnly: tags.unincorporatedOnly,
        reviewRequired: !(row.source as any)?.metadata?.tags || tags.reviewRequired, resourceOnly: tags.resourceOnly,
      });
    }
    if ((data?.length ?? 0) < 500) break;
  }
  return chunks;
}
