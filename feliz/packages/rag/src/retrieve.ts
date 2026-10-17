import type { Jurisdiction, SearchRow } from "@feliz/db";
import { hybridSearch } from "./hybrid-search.js";

export interface RetrieveOptions {
  /** Where the renter lives. Statewide law is always included. Omit if unknown. */
  jurisdiction?: Jurisdiction;
  /** Passages to return (default 5). */
  k?: number;
  /** Max passages from one page, so one long page can't crowd out the rest (default 2). */
  perUrl?: number;
}

export type Passage = SearchRow;

export interface RetrieveResult {
  passages: Passage[];
  /**
   * "none": nothing relevant. Say so and refer the renter to a human resource.
   * "low":  related material only. Hedge, or ask a follow-up question.
   * "high": answer from these passages.
   */
  confidence: "high" | "low" | "none";
  topSimilarity: number;
}

// Cosine-similarity cutoffs for gemini-embedding-2.
// Starting guesses: recalibrate on the eval questions once real data is ingested.
export const CONFIDENCE_THRESHOLDS = { high: 0.5, low: 0.35 };

export async function retrieve(question: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
  const { jurisdiction, k = 5, perUrl = 2 } = opts;
  const rows = await hybridSearch(question, {
    jurisdictions: jurisdiction ? [jurisdiction, "california"] : null,
    matchCount: k * 4,
  });
  return selectPassages(rows, { k, perUrl });
}

/** Pure post-processing, split out so it can be tested without a database. */
export function selectPassages(rows: SearchRow[], { k = 5, perUrl = 2 } = {}): RetrieveResult {
  const perUrlCount = new Map<string, number>();
  const passages: Passage[] = [];
  for (const row of [...rows].sort((a, b) => b.score - a.score || a.authority - b.authority)) {
    const n = perUrlCount.get(row.url) ?? 0;
    if (n >= perUrl) continue;
    perUrlCount.set(row.url, n + 1);
    passages.push(row);
    if (passages.length >= k) break;
  }
  const topSimilarity = Math.max(0, ...rows.map((r) => r.similarity ?? 0));
  const confidence =
    topSimilarity >= CONFIDENCE_THRESHOLDS.high ? "high"
    : topSimilarity >= CONFIDENCE_THRESHOLDS.low ? "low"
    : "none";
  return { passages, confidence, topSimilarity };
}
