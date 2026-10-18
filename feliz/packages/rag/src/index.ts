export { embedDocuments, embedQuery, embedTexts, embeddingInput, chunkEmbeddingText, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_MAX_TOKENS, type EmbeddingTask, type EmbedOptions } from "./embed.js";
export { rankLegalChunks, chunkApplies, type RankedChunk, type SearchOptions } from "./hybrid-search.js";
export { retrieve, type RetrieveOptions, type RetrieveResult } from "./retrieve.js";
export { sourceLine, citationsInReply } from "./citations.js";
