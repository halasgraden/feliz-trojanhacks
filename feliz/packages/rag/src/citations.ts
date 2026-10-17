import type { Passage } from "./retrieve.js";

export interface Citation {
  n: number;
  sourceName: string;
  title: string | null;
  url: string;
}

/**
 * Numbered context for the LLM prompt. Instruct the model to answer only from
 * these passages and cite them as [1], [2]; resolve numbers with citationsFor().
 */
export function formatContext(passages: Passage[]): string {
  return passages
    .map((p, i) => `[${i + 1}] ${p.source_name}${p.title ? ` — ${p.title}` : ""}\nURL: ${p.url}\n${p.content}`)
    .join("\n\n---\n\n");
}

/** One entry per passage, numbered to match formatContext(). */
export function citationsFor(passages: Passage[]): Citation[] {
  return passages.map((p, i) => ({ n: i + 1, sourceName: p.source_name, title: p.title, url: p.url }));
}

/** The [n] markers actually used in an answer, mapped to their sources (for an SMS "Sources:" footer). */
export function usedCitations(answer: string, passages: Passage[]): Citation[] {
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const seen = new Set<string>();
  return citationsFor(passages).filter((c) => {
    if (!used.has(c.n) || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}
