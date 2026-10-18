import type { LegalChunk, Topic } from "@feliz/db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./embed.js";

export interface SearchOptions {
  city?: string | null; county?: string | null; state?: string | null;
  unincorporated?: boolean; topic?: Topic | null; limit?: number; queryEmbedding?: number[];
}
export interface RankedChunk extends LegalChunk { score: number; similarity: number | null }
// Common words that say nothing about the legal issue, in English and Spanish (renters write in both).
const STOP = new Set((
  "the a an is are was were my me i to of in on for and or it this that can do does with from have has " +
  "landlord tenant rental apartment how what when why who will would should could did not " +
  "que para por una uno los las del con como cuando cuanto cuánto tengo tiene mis mi sus su " +
  "esta este esto pero sin sobre hay ser fue son muy más mas casero arrendador dueño"
).split(" "));
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const terms = (s: string) => [...new Set(words(s).filter((w) => w.length >= 3 && !STOP.has(w)))];
/**
 * A term matches a word it begins ("deposit" ~ "deposits", "rent" ~ "renters"), never a fragment
 * inside one: substring matching let Spanish "para" match "paragraph" and English "rent" match
 * "parent", which pushed the right passage from #2 to #10 for a Spanish eviction question.
 */
const matchesTerm = (text: string[], term: string) => text.some((w) => w.startsWith(term));

/** "los angeles ", "Los  Angeles" and "LOS ANGELES" are the same place. */
const place = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Apply before ranking. Unknown location does not authorize local rules. */
export function chunkApplies(c: LegalChunk, opts: SearchOptions): boolean {
  if (c.reviewRequired || c.resourceOnly) return false;
  if (c.unincorporatedOnly && opts.unincorporated !== true) return false;
  if (c.state && place(c.state) !== place(opts.state)) return false;
  if (c.county && place(c.county) !== place(opts.county)) return false;
  if (c.city && place(c.city) !== place(opts.city)) return false;
  if (opts.topic && c.topics.length && !c.topics.includes(opts.topic)) return false;
  return true;
}

/** In-process reciprocal rank fusion for the small hackathon corpus; no SQL RPC required. */
export function rankLegalChunks(chunks: LegalChunk[], query: string, opts: SearchOptions = {}): RankedChunk[] {
  const queryTerms = terms(query);
  const candidates = chunks.filter((c) => chunkApplies(c, opts));
  const lexical = new Map(candidates.map((c) => {
    const text = words(`${c.title} ${c.heading} ${c.body}`);
    return [c.id, queryTerms.reduce((n, term) => n + Number(matchesTerm(text, term)), 0) / Math.max(1, queryTerms.length)];
  }));
  const similarity = new Map<string, number>();
  if (opts.queryEmbedding) {
    if (opts.queryEmbedding.length !== EMBEDDING_DIMENSIONS || !opts.queryEmbedding.every(Number.isFinite)) throw new Error("Invalid query embedding");
    const qNorm = Math.hypot(...opts.queryEmbedding);
    if (!qNorm) throw new Error("Zero query embedding");
    for (const c of candidates) {
      if (!c.embedding || c.embeddingModel !== EMBEDDING_MODEL) continue;
      if (c.embedding.length !== EMBEDDING_DIMENSIONS || !c.embedding.every(Number.isFinite)) continue;
      const norm = Math.hypot(...c.embedding);
      if (norm) similarity.set(c.id, c.embedding.reduce((sum, v, i) => sum + v * opts.queryEmbedding![i], 0) / norm / qNorm);
    }
  }
  const ranks = (scores: Map<string, number>) => new Map([...scores].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id], i) => [id, i + 1]));
  const lexRank = ranks(lexical), semRank = ranks(similarity);
  const rows = candidates.filter((c) => lexRank.has(c.id) || semRank.has(c.id)).map((c) => ({
    ...c, similarity: similarity.get(c.id) ?? null,
    score: (lexRank.has(c.id) ? 1 / (60 + lexRank.get(c.id)!) : 0) + (semRank.has(c.id) ? 1 / (60 + semRank.get(c.id)!) : 0),
  })).sort((a, b) => b.score - a.score || (b.similarity ?? 0) - (a.similarity ?? 0) || a.id.localeCompare(b.id));
  const perDocument = new Map<string, number>();
  return rows.filter((row) => { const n = perDocument.get(row.documentId) ?? 0; perDocument.set(row.documentId, n + 1); return n < 2; }).slice(0, opts.limit ?? 5);
}
