// Retrieval (rankLegalChunks, runLegalSearch) and citations (sourceLine) belong to the
// agent side; see docs/rag-supabase.md. This package currently provides the embeddings.
export {
  embedDocuments,
  embedQuery,
  embedTexts,
  chunkEmbeddingText,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type EmbeddingTask,
  type EmbedOptions,
} from "./embed.js";
