import { chunkEmbeddingText, embedDocuments } from "@feliz/rag";

/** Embed chunks from "heading\nbody", the same string the agent's ranker expects. */
export function embedChunks(chunks: { heading: string; body: string }[]): Promise<number[][]> {
  return embedDocuments(chunks.map(chunkEmbeddingText));
}
