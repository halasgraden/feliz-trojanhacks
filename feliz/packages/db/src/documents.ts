import { getSupabase } from "./client.js";

export type Topic = "security_deposit" | "eviction" | "rent_increase";

/** One row of legal_chunks, with the TypeScript names from docs/rag-supabase.md. */
export interface LegalChunk {
  id: string; // "{documentId}_{index}"
  documentId: string;
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
}

const toRow = (c: LegalChunk) => ({
  id: c.id,
  document_id: c.documentId,
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
});

const BATCH = 100; // ~100 rows of 768-d vectors stays well under the request size limit

export async function upsertLegalChunks(chunks: LegalChunk[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH) {
    const { error } = await getSupabase()
      .from("legal_chunks")
      .upsert(chunks.slice(i, i + BATCH).map(toRow), { onConflict: "id" });
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

/** content_hash last loaded for each document, to skip pages whose text hasn't changed. */
export async function loadedContentHashes(documentIds: string[]): Promise<Map<string, string>> {
  if (!documentIds.length) return new Map();
  const { data, error } = await getSupabase()
    .from("legal_documents")
    .select("document_id, content_hash")
    .in("document_id", documentIds);
  if (error) throw new Error(`loadedContentHashes: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.document_id as string, r.content_hash as string]));
}

export async function recordLoadedDocument(doc: {
  documentId: string;
  url: string;
  contentHash: string;
  chunkCount: number;
}): Promise<void> {
  const { error } = await getSupabase().from("legal_documents").upsert(
    {
      document_id: doc.documentId,
      url: doc.url,
      content_hash: doc.contentHash,
      chunk_count: doc.chunkCount,
      loaded_at: new Date().toISOString(),
    },
    { onConflict: "document_id" },
  );
  if (error) throw new Error(`recordLoadedDocument: ${error.message}`);
}
