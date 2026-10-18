import { randomUUID } from "node:crypto";
import type { LegalChunk } from "./documents.js";
import { REFERRALS } from "./resources.js";
import type {
  Account,
  CaseChunk,
  CaseEvent,
  CaseFile,
  CaseRecord,
  FelizStore,
  Referral,
  TraceRecord,
} from "./cases.js";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function blankCase(id: string, accountId: string, now: string): CaseRecord {
  return {
    id,
    accountId,
    category: "unknown",
    facts: {},
    pending: [],
    rejected: [],
    asked: [],
    missing: [],
    createdAt: now,
    updatedAt: now,
  };
}

export class MemoryStore implements FelizStore {
  private accounts: Account[] = [];
  private cases: CaseRecord[] = [];
  private legal: LegalChunk[] = [];
  private files: CaseFile[] = [];
  private chunks: CaseChunk[] = [];
  private events: CaseEvent[] = [];
  private traceLog: TraceRecord[] = [];

  constructor(private referralList: Referral[] = REFERRALS) {}

  async upsertAccount(phone: string): Promise<Account> {
    const normalized = phone.trim();
    const existing = this.accounts.find((account) => account.phone === normalized);
    if (existing) return existing;
    const account = { id: createId("acct"), phone: normalized, createdAt: new Date().toISOString() };
    this.accounts.push(account);
    return account;
  }

  async createCase(accountId: string): Promise<CaseRecord> {
    this.requireAccount(accountId);
    const record = blankCase(createId("case"), accountId, new Date().toISOString());
    this.cases.push(record);
    return structuredClone(record);
  }

  async latestCase(accountId: string): Promise<CaseRecord | null> {
    const matches = this.cases.filter((record) => record.accountId === accountId);
    const record = matches[matches.length - 1];
    return record ? structuredClone(record) : null;
  }

  async getCase(caseId: string, accountId: string): Promise<CaseRecord | null> {
    const record = this.cases.find((item) => item.id === caseId && item.accountId === accountId);
    return record ? structuredClone(record) : null;
  }

  async saveCase(record: CaseRecord): Promise<void> {
    const index = this.cases.findIndex((item) => item.id === record.id && item.accountId === record.accountId);
    if (index < 0) throw new Error("Case not found.");
    this.cases[index] = structuredClone(record);
  }

  async legalCorpus(): Promise<LegalChunk[]> {
    return this.legal.map((chunk) => structuredClone(chunk));
  }

  async insertLegalChunk(chunk: LegalChunk): Promise<void> {
    this.legal = this.legal.filter((item) => item.id !== chunk.id);
    this.legal.push(structuredClone(chunk));
  }

  async insertCaseFile(file: CaseFile): Promise<void> {
    this.requireCase(file.caseId, file.accountId);
    this.files = this.files.filter((item) => item.id !== file.id);
    this.files.push(structuredClone(file));
  }

  async insertCaseChunk(chunk: CaseChunk): Promise<void> {
    this.requireCase(chunk.caseId, chunk.accountId);
    this.chunks = this.chunks.filter((item) => item.id !== chunk.id);
    this.chunks.push(structuredClone(chunk));
  }

  async caseChunks(caseId: string, accountId: string): Promise<CaseChunk[]> {
    return this.chunks
      .filter((chunk) => chunk.caseId === caseId && chunk.accountId === accountId)
      .map((chunk) => structuredClone(chunk));
  }

  async addEvent(event: CaseEvent): Promise<void> {
    this.requireCase(event.caseId, event.accountId);
    this.events.push(structuredClone(event));
  }

  async listEvents(caseId: string, accountId: string): Promise<CaseEvent[]> {
    return this.events
      .filter((event) => event.caseId === caseId && event.accountId === accountId)
      .map((event) => structuredClone(event));
  }

  async addTrace(trace: TraceRecord): Promise<void> {
    this.traceLog.push(structuredClone(trace));
  }

  async traces(caseId: string): Promise<TraceRecord[]> {
    return this.traceLog.filter((trace) => trace.caseId === caseId).map((trace) => structuredClone(trace));
  }

  async referrals(): Promise<Referral[]> {
    return this.referralList.map((referral) => structuredClone(referral));
  }

  private requireAccount(accountId: string) {
    if (!this.accounts.some((account) => account.id === accountId)) throw new Error("Account not found.");
  }

  private requireCase(caseId: string, accountId: string) {
    if (!this.cases.some((record) => record.id === caseId && record.accountId === accountId)) {
      throw new Error("Case not found.");
    }
  }
}

export function createMemoryStore(): MemoryStore {
  return new MemoryStore();
}
