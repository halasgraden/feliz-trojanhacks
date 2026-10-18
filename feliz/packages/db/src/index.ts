export { getSupabase } from "./client.js";
export {
  upsertLegalSources,
  legalSourceRow,
  legalChunkRow,
  upsertLegalChunks,
  deleteStaleLegalChunks,
  loadedState,
  listLegalChunks,
  type LegalChunk,
  type LegalSource,
  type Topic,
} from "./documents.js";
export { createId, createMemoryStore, MemoryStore } from "./memory.js";
export { createSupabaseCaseStore } from "./supabase-cases.js";
export { REFERRALS, matchReferrals } from "./resources.js";
export type {
  Account,
  CaseChunk,
  CaseEvent,
  CaseFacts,
  CaseFile,
  CaseFileSearchRecord,
  CaseRecord,
  FelizStore,
  LegalSearchRecord,
  PendingFact,
  Referral,
  RejectedFact,
  TracePayload,
  TraceRecord,
} from "./cases.js";
