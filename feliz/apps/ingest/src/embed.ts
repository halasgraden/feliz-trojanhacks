import { embedDocuments, type DocumentInput } from "@feliz/rag";

const BATCH = 100;

/** Embed passages as retrieval documents (title + text), reporting progress per batch. */
export async function embedPassages(
  passages: DocumentInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < passages.length; i += BATCH) {
    out.push(...(await embedDocuments(passages.slice(i, i + BATCH))));
    onProgress?.(out.length, passages.length);
  }
  return out;
}
