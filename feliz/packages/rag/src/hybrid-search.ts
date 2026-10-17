import { hybridSearch as searchDb, type Jurisdiction, type SearchRow } from "@feliz/db";
import { embedQuery } from "./embed.js";

/** Embed the question and run vector + keyword search in Postgres. */
export async function hybridSearch(
  question: string,
  opts: { jurisdictions: Jurisdiction[] | null; matchCount: number },
): Promise<SearchRow[]> {
  const queryEmbedding = await embedQuery(question);
  return searchDb({
    queryText: question,
    queryEmbedding,
    matchCount: opts.matchCount,
    jurisdictions: opts.jurisdictions,
  });
}
