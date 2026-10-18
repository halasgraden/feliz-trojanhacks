import { randomUUID } from "node:crypto";
import type { LegalChunk } from "./documents.js";
import { getSupabase } from "./client.js";
import { REFERRALS } from "./resources.js";
import type {
  Account,
  CaseChunk,
  CaseEvent,
  CaseFacts,
  CaseFile,
  CaseRecord,
  FelizStore,
  PendingFact,
  Referral,
  RejectedFact,
  TracePayload,
  TraceRecord,
} from "./cases.js";

export function createSupabaseCaseStore(): FelizStore {
  const sb = () => getSupabase();

  return {
    async upsertAccount(phone: string): Promise<Account> {
      const { data, error } = await sb()
        .from("accounts")
        .upsert({ phone: phone.trim() }, { onConflict: "phone" })
        .select("id, phone, created_at")
        .single();
      if (error) throw new Error(`upsertAccount: ${error.message}`);
      return { id: data.id as string, phone: data.phone as string, createdAt: data.created_at as string };
    },

    async createCase(accountId: string): Promise<CaseRecord> {
      const now = new Date().toISOString();
      const row = {
        id: `case_${randomUUID().slice(0, 8)}`,
        account_id: accountId,
        category: "unknown",
        facts: {},
        pending: [],
        rejected: [],
        asked: [],
        missing: [],
        created_at: now,
        updated_at: now,
      };
      const { data, error } = await sb().from("cases").insert(row).select("*").single();
      if (error) throw new Error(`createCase: ${error.message}`);
      return mapCase(data);
    },

    async latestCase(accountId: string): Promise<CaseRecord | null> {
      const { data, error } = await sb()
        .from("cases")
        .select("*")
        .eq("account_id", accountId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`latestCase: ${error.message}`);
      return data?.[0] ? mapCase(data[0]) : null;
    },

    async getCase(caseId: string, accountId: string): Promise<CaseRecord | null> {
      const { data, error } = await sb().from("cases").select("*").eq("id", caseId).eq("account_id", accountId).limit(1);
      if (error) throw new Error(`getCase: ${error.message}`);
      return data?.[0] ? mapCase(data[0]) : null;
    },

    async saveCase(record: CaseRecord): Promise<void> {
      const { error } = await sb()
        .from("cases")
        .update({
          category: record.category,
          facts: record.facts,
          pending: record.pending,
          rejected: record.rejected,
          asked: record.asked,
          missing: record.missing,
          updated_at: record.updatedAt,
        })
        .eq("id", record.id)
        .eq("account_id", record.accountId);
      if (error) throw new Error(`saveCase: ${error.message}`);
    },

    async legalCorpus(): Promise<LegalChunk[] | null> {
      return null;
    },

    async insertLegalChunk(): Promise<void> {
      throw new Error("Load legal chunks with npm run ingest. The agent does not write the shared corpus.");
    },

    async insertCaseFile(file: CaseFile): Promise<void> {
      const { error } = await sb().from("case_files").upsert({
        id: file.id,
        case_id: file.caseId,
        account_id: file.accountId,
        filename: file.filename,
        media_type: file.mediaType,
        extracted_text: file.extractedText,
      });
      if (error) throw new Error(`insertCaseFile: ${error.message}`);
    },

    async insertCaseChunk(chunk: CaseChunk): Promise<void> {
      const { error } = await sb().from("case_chunks").upsert({
        id: chunk.id,
        case_id: chunk.caseId,
        account_id: chunk.accountId,
        corpus: chunk.corpus,
        source_label: chunk.sourceLabel,
        body: chunk.body,
        file_id: chunk.fileId,
        embedding: chunk.embedding ? `[${chunk.embedding.join(",")}]` : null,
      });
      if (error) throw new Error(`insertCaseChunk: ${error.message}`);
    },

    async caseChunks(caseId: string, accountId: string): Promise<CaseChunk[]> {
      const { data, error } = await sb().from("case_chunks").select("*").eq("case_id", caseId).eq("account_id", accountId);
      if (error) throw new Error(`caseChunks: ${error.message}`);
      return (data ?? []).map(mapCaseChunk);
    },

    async addEvent(event: CaseEvent): Promise<void> {
      const { error } = await sb().from("case_events").insert({
        id: event.id,
        case_id: event.caseId,
        account_id: event.accountId,
        role: event.role,
        body: event.body,
        created_at: event.createdAt,
      });
      if (error) throw new Error(`addEvent: ${error.message}`);
    },

    async listEvents(caseId: string, accountId: string): Promise<CaseEvent[]> {
      const { data, error } = await sb()
        .from("case_events")
        .select("*")
        .eq("case_id", caseId)
        .eq("account_id", accountId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`listEvents: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        caseId: row.case_id as string,
        accountId: row.account_id as string,
        role: row.role as "user" | "assistant",
        body: row.body as string,
        createdAt: row.created_at as string,
      }));
    },

    async addTrace(trace: TraceRecord): Promise<void> {
      const { error } = await sb().from("traces").insert({
        id: trace.id,
        case_id: trace.caseId,
        account_id: trace.accountId,
        created_at: trace.createdAt,
        payload: trace.payload,
      });
      if (error) throw new Error(`addTrace: ${error.message}`);
    },

    async traces(caseId: string): Promise<TraceRecord[]> {
      const { data, error } = await sb().from("traces").select("*").eq("case_id", caseId).order("created_at", { ascending: true });
      if (error) throw new Error(`traces: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        caseId: row.case_id as string,
        accountId: row.account_id as string,
        createdAt: row.created_at as string,
        payload: row.payload as TracePayload,
      }));
    },

    async referrals(): Promise<Referral[]> {
      const { data, error } = await sb().from("housing_resources").select("*");
      if (error) throw new Error(`referrals: ${error.message}`);
      if (!data?.length) return REFERRALS.map((referral) => structuredClone(referral));
      return data.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        url: row.url as string,
        state: (row.state as string | null) ?? null,
        county: (row.county as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        disputes: (row.disputes as string[] | null) ?? [],
        notes: (row.notes as string | null) ?? "",
      }));
    },
  };
}

function mapCase(row: Record<string, unknown>): CaseRecord {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    category: row.category as string,
    facts: (row.facts as CaseFacts) ?? {},
    pending: (row.pending as PendingFact[]) ?? [],
    rejected: (row.rejected as RejectedFact[]) ?? [],
    asked: (row.asked as string[]) ?? [],
    missing: (row.missing as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCaseChunk(row: Record<string, unknown>): CaseChunk {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    accountId: row.account_id as string,
    corpus: row.corpus as "case_file" | "chat",
    sourceLabel: row.source_label as string,
    body: row.body as string,
    fileId: (row.file_id as string | null) ?? null,
  };
}
