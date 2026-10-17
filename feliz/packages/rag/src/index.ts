export { retrieve, selectPassages, CONFIDENCE_THRESHOLDS } from "./retrieve.js";
export type { Passage, RetrieveOptions, RetrieveResult } from "./retrieve.js";
export { hybridSearch } from "./hybrid-search.js";
export { formatContext, citationsFor, usedCitations, type Citation } from "./citations.js";
export { embedQuery, embedDocuments, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, type DocumentInput } from "./embed.js";
