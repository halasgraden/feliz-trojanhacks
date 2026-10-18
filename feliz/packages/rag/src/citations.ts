import type { LegalChunk } from "@feliz/db";
export function sourceLine(c: LegalChunk): string {
  if ([c.publisher, c.title, c.heading, c.url].some((s) => !s || /[\r\n]/.test(s)) || /"/.test(c.title) || /\s/.test(c.url) || !/^\d{4}-\d{2}-\d{2}$/.test(c.fetchedAt)) throw new Error(`Chunk ${c.id} has invalid citation metadata`);
  return `Source: ${c.publisher}, "${c.title}", ${c.url}, fetched ${c.fetchedAt}. Section: ${c.heading}.`;
}
/** Source lines must exactly match evidence returned for this turn. A repeated heading covers every chunk that shares it. */
export function citationsInReply(reply: string, chunks: LegalChunk[]): LegalChunk[] {
  const used = new Map<string, LegalChunk>();
  for (const line of reply.split("\n").map((l) => l.trim())) {
    if (!line.startsWith("Source:")) continue;
    const matches = chunks.filter((chunk) => {
      try {
        return sourceLine(chunk) === line;
      } catch {
        return false;
      }
    });
    if (!matches.length) throw new Error("Reply cites a source not returned for this turn");
    for (const chunk of matches) used.set(chunk.id, chunk);
  }
  return [...used.values()];
}
