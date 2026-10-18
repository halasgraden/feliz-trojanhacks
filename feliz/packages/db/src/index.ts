export { getSupabase } from "./client.js";
export {
  upsertLegalSources,
  legalSourceRow,
  legalChunkRow,
  upsertLegalChunks,
  deleteStaleLegalChunks,
  loadedState,
  type LegalChunk,
  type LegalSource,
  type Topic,
} from "./documents.js";
