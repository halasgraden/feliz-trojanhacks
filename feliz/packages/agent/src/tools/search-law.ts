import type { CaseFacts, LegalChunk, LegalSearchRecord, Topic } from "@feliz/db";
import { chunkApplies, type RetrieveOptions, type RetrieveResult } from "@feliz/rag";

export type SearchHit = {
  id: string;
  publisher: string;
  title: string;
  url: string;
  fetchedAt: string;
  heading: string;
  body: string;
};

export type LegalSearchResult = {
  queries: LegalSearchRecord[];
  chunks: LegalChunk[];
  retrieval: "lexical" | "hybrid";
  relevance: RetrieveResult["relevance"];
  warnings: string[];
  queryTruncated: boolean;
  publicResult: { queries: LegalSearchRecord[]; chunks: SearchHit[] };
};

const TOPICS = new Set<Topic>(["security_deposit", "eviction", "rent_increase"]);

/** Scope retrieve() from confirmed facts. A missing state would drop every California page. */
export function searchScope(facts: CaseFacts, category: string): RetrieveOptions {
  return {
    state: "CA",
    county: facts.county ?? null,
    city: facts.city ?? null,
    topic: TOPICS.has(category as Topic) ? (category as Topic) : null,
    unincorporated: facts.unincorporated === true,
  };
}

/** Keep the newest lines. embedQuery already drops everything before the last 512 tokens. */
export function retrievalQuery(transcript: string): string {
  const lines = transcript.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? "";
  const latest = lines[lines.length - 1] ?? "";
  if (latest.length >= 40) return latest;
  return lines.slice(-4).join("\n");
}

export function toSearchResult(query: string, scope: RetrieveOptions, found: RetrieveResult): LegalSearchResult {
  const record: LegalSearchRecord = {
    query,
    state: scope.state ?? "CA",
    county: scope.county ?? null,
    city: scope.city ?? null,
    topic: scope.topic ?? null,
    unincorporated: scope.unincorporated === true,
    hitIds: found.chunks.map((chunk) => chunk.id),
    relevance: found.relevance,
  };
  return {
    queries: [record],
    chunks: found.chunks,
    retrieval: found.retrieval,
    relevance: found.relevance,
    warnings: found.warnings,
    queryTruncated: found.queryTruncated,
    publicResult: { queries: [record], chunks: found.chunks.map(toHit) },
  };
}

export function readReturnedChunk(
  chunks: LegalChunk[],
  chunkId: string,
  scope: RetrieveOptions,
): { chunk: LegalChunk | null; error?: string } {
  const chunk = chunks.find((item) => item.id === chunkId);
  if (!chunk) return { chunk: null, error: "That id is not in the legal documents." };
  if (!chunkApplies(chunk, scope)) return { chunk: null, error: "That document is outside this city's records." };
  return { chunk };
}

function toHit(chunk: LegalChunk): SearchHit {
  return {
    id: chunk.id,
    publisher: chunk.publisher,
    title: chunk.title,
    url: chunk.url,
    fetchedAt: chunk.fetchedAt,
    heading: chunk.heading,
    body: chunk.body,
  };
}
