import type { LegalChunk, Topic } from "./documents.js";

export type FactValue = string | number | boolean;

export type CaseFacts = {
  city?: string;
  county?: string;
  unincorporated?: boolean;
  moveOutDate?: string;
  itemizedStatement?: "yes" | "no";
  amountWithheld?: number;
  depositAmount?: number;
  noticeDate?: string;
};

export type PendingFact = {
  field: keyof CaseFacts;
  value: string;
  sourceLabel: string;
  sourceId: string;
};

export type RejectedFact = {
  field: string;
  sourceId: string;
};

export type CaseRecord = {
  id: string;
  accountId: string;
  category: string;
  facts: CaseFacts;
  pending: PendingFact[];
  rejected: RejectedFact[];
  asked: string[];
  missing: string[];
  createdAt: string;
  updatedAt: string;
};

export type Account = {
  id: string;
  phone: string;
  createdAt: string;
};

export type CaseChunk = {
  id: string;
  caseId: string;
  accountId: string;
  corpus: "case_file" | "chat";
  sourceLabel: string;
  body: string;
  fileId: string | null;
  embedding?: number[];
};

export type CaseFile = {
  id: string;
  caseId: string;
  accountId: string;
  filename: string;
  mediaType: string;
  extractedText: string;
};

export type CaseEvent = {
  id: string;
  caseId: string;
  accountId: string;
  role: "user" | "assistant";
  body: string;
  createdAt: string;
};

export type LegalSearchRecord = {
  query: string;
  state: string;
  county: string | null;
  city: string | null;
  topic: Topic | null;
  unincorporated: boolean;
  hitIds: string[];
  relevance: "strong" | "weak" | "unknown";
};

export type CaseFileSearchRecord = {
  field: string;
  sourceLabel: string | null;
  proposed: string | null;
};

export type TracePayload = {
  factsBefore: CaseFacts;
  factsAfter: CaseFacts;
  missing: string[];
  urgency: "routine" | "urgent";
  caseFileSearches: CaseFileSearchRecord[];
  legalSearches: LegalSearchRecord[];
  dropped: { text: string; reason: string }[];
  chunkIds: string[];
  retrieved: { id: string; publisher: string; title: string; url: string; body: string }[];
  model: string;
  retrieval: "lexical" | "hybrid";
  relevance: "strong" | "weak" | "unknown";
  warnings: string[];
  queryTruncated: boolean;
  validationProblems: string[];
};

export type TraceRecord = {
  id: string;
  caseId: string;
  accountId: string;
  createdAt: string;
  payload: TracePayload;
};

export type Referral = {
  id: string;
  name: string;
  url: string;
  state: string | null;
  county: string | null;
  city: string | null;
  disputes: string[];
  notes: string;
};

export interface FelizStore {
  upsertAccount(phone: string): Promise<Account>;
  createCase(accountId: string): Promise<CaseRecord>;
  latestCase(accountId: string): Promise<CaseRecord | null>;
  getCase(caseId: string, accountId: string): Promise<CaseRecord | null>;
  saveCase(record: CaseRecord): Promise<void>;
  /** Null means retrieve() should load legal_chunks from Supabase. */
  legalCorpus(): Promise<LegalChunk[] | null>;
  insertLegalChunk(chunk: LegalChunk): Promise<void>;
  insertCaseFile(file: CaseFile): Promise<void>;
  insertCaseChunk(chunk: CaseChunk): Promise<void>;
  caseChunks(caseId: string, accountId: string): Promise<CaseChunk[]>;
  addEvent(event: CaseEvent): Promise<void>;
  listEvents(caseId: string, accountId: string): Promise<CaseEvent[]>;
  addTrace(trace: TraceRecord): Promise<void>;
  traces(caseId: string): Promise<TraceRecord[]>;
  referrals(): Promise<Referral[]>;
}
