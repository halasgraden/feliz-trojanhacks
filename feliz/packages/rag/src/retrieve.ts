import { listLegalChunks, type LegalChunk } from "@feliz/db";
import { embedQuery } from "./embed.js";
import { rankLegalChunks, type SearchOptions, type RankedChunk } from "./hybrid-search.js";

export interface RetrieveOptions extends Omit<SearchOptions, "queryEmbedding"> {
  /** Preloaded corpus for a DB-free demo or the caller's own cache. */
  chunks?: LegalChunk[];
  lexicalOnly?: boolean;
  /** How long the corpus loaded from Supabase is reused (default 5 minutes; 0 reloads every call). */
  cacheTtlMs?: number;
}

export interface RetrieveResult {
  chunks: RankedChunk[];
  retrieval: "hybrid" | "lexical";
  status: "ok" | "no_evidence";
  /**
   * Whether the question reads like a renter's housing question (advisory, see RELEVANCE).
   * "weak": consider asking what happened instead of answering. "unknown": no embedding available.
   */
  relevance: "strong" | "weak" | "unknown";
  /** Best cosine similarity between the question and a returned passage. */
  topSimilarity: number | null;
  /** Similarity to the closest example renter question (English or Spanish). */
  topicSimilarity: number | null;
  /** The question was longer than the model accepts; only its end was embedded. */
  queryTruncated: boolean;
  warnings: string[];
}

/**
 * Example renter questions in English and Spanish. A question's similarity to the closest one
 * separates housing from non-housing questions far better than similarity to legal passages,
 * which scores Spanish questions low. Measured on the real model (docs/local-rag-test-report.md).
 */
const TOPIC_EXAMPLES = [
  "My landlord won't give back my deposit after I moved out",
  "I received an eviction notice from my landlord",
  "My landlord is raising the rent on my apartment",
  "My landlord refuses to make repairs in my unit",
  "Question about my rights as a renter and my lease",
  "Mi casero no me regresa el depósito de la renta",
  "Recibí un aviso de desalojo de mi casero",
  "Mi casero me subió la renta del apartamento",
  "El dueño no quiere hacer reparaciones en mi vivienda",
];
/**
 * Strong if the question resembles a renter question, or a passage matches it closely.
 * These cutoffs were measured on multilingual-e5-base. They are not calibrated for
 * gemini-embedding-001, and a weak score never drops a passage.
 */
export const RELEVANCE = { topic: 0.86, passage: 0.845 } as const;

let topicVectors: Promise<number[][]> | undefined;
let corpus: { at: number; chunks: Promise<LegalChunk[]> } | undefined;

/** Drop the cached corpus, e.g. right after re-running ingest. */
export function clearCorpusCache() {
  corpus = undefined;
}

function loadCorpus(ttlMs: number): Promise<LegalChunk[]> {
  if (!corpus || ttlMs <= 0 || Date.now() - corpus.at > ttlMs) {
    const chunks = listLegalChunks();
    corpus = { at: Date.now(), chunks };
    chunks.catch(() => { if (corpus?.chunks === chunks) corpus = undefined; });
  }
  return corpus.chunks;
}

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
  const empty = { retrieval: "lexical" as const, relevance: "unknown" as const, topSimilarity: null, topicSimilarity: null, queryTruncated: false };
  if (!query.trim()) return { ...empty, chunks: [], status: "no_evidence", warnings: [] };
  const chunks = opts.chunks ?? await loadCorpus(opts.cacheTtlMs ?? 5 * 60_000);
  const warnings: string[] = [];

  let queryEmbedding: number[] | undefined;
  let queryTruncated = false;
  if (!opts.lexicalOnly) {
    try {
      queryEmbedding = await embedQuery(query, { onTruncate: () => { queryTruncated = true; } });
    } catch (error) {
      // Keyword search still finds evidence; a model problem shouldn't fail the renter's turn.
      warnings.push(`Embedding failed, used keyword search only: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const hits = rankLegalChunks(chunks, query, { ...opts, queryEmbedding });
  const sims = hits.map((c) => c.similarity).filter((s): s is number => s !== null);
  const topSimilarity = sims.length ? Math.max(...sims) : null;

  let topicSimilarity: number | null = null;
  let relevance: RetrieveResult["relevance"] = "unknown";
  if (queryEmbedding) {
    try {
      topicVectors ??= Promise.all(TOPIC_EXAMPLES.map((q) => embedQuery(q)));
      const examples = await topicVectors;
      topicSimilarity = Math.max(...examples.map((v) => dot(queryEmbedding!, v)));
      relevance = topicSimilarity >= RELEVANCE.topic || (topSimilarity ?? 0) >= RELEVANCE.passage ? "strong" : "weak";
    } catch (error) {
      topicVectors = undefined;
      warnings.push(`Relevance check skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    chunks: hits,
    retrieval: queryEmbedding && sims.length ? "hybrid" : "lexical",
    status: hits.length ? "ok" : "no_evidence",
    relevance,
    topSimilarity,
    topicSimilarity,
    queryTruncated,
    warnings,
  };
}
