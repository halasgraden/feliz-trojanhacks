import {
  createId,
  matchReferrals,
  type CaseFacts,
  type CaseRecord,
  type FelizStore,
  type LegalChunk,
  type PendingFact,
  type TracePayload,
  type TraceRecord,
} from "@feliz/db";
import { citationsInReply, retrieve as retrieveLegal, type RetrieveOptions, type RetrieveResult } from "@feliz/rag";
import {
  classifyIssue,
  countyFor,
  missingRequirements,
  questionFor,
  type Category,
  type Requirement,
} from "@feliz/routing";
import { checkUrgency } from "@feliz/routing";
import { answersToAsked, extractFacts, isNo, isYes, proposeField } from "./extract.js";
import type { LanguageModel } from "./gemini.js";
import { confirmationLine, composeFromChunks, NOT_COVERED, offerFor, presentReply } from "./reply.js";
import { nextFacts } from "./state.js";
import { readReturnedChunk, retrievalQuery, searchScope, toSearchResult } from "./tools/search-law.js";
import { validateReply } from "./validate.js";

export type Citation = {
  chunkId: string;
  publisher: string;
  title: string;
  url: string;
  fetchedAt: string;
  heading: string;
};

export type UserReply = {
  caseId: string;
  reply: string;
  /** Separate texts to send, in order. The disclaimer is only the first text of a new case. */
  texts: string[];
  citations: Citation[];
  followUps: string[];
  confirmations: PendingFact[];
};

export type TurnInput = {
  accountId: string;
  caseId: string;
  message: string;
  now?: string;
};

export type RetrieveFn = (query: string, options: RetrieveOptions) => Promise<RetrieveResult>;

export type AgentDeps = {
  model: LanguageModel;
  /** Defaults to retrieve(), which embeds the question with gemini-embedding-001. Tests can pass a fake. */
  retrieve?: RetrieveFn;
  now?: string;
};

const SLOTS = 2;

export async function handleTurn(store: FelizStore, input: TurnInput, deps: AgentDeps): Promise<UserReply> {
  const now = input.now ?? deps.now ?? new Date().toISOString();
  const today = now.slice(0, 10);
  const record = await store.getCase(input.caseId, input.accountId);
  if (!record) throw new Error("Case not found.");

  const factsBefore = { ...record.facts };
  const text = input.message.trim();
  await store.addEvent({
    id: createId("event"),
    caseId: record.id,
    accountId: record.accountId,
    role: "user",
    body: text,
    createdAt: now,
  });
  if (text) {
    await store.insertCaseChunk({
      id: createId("chat"),
      caseId: record.id,
      accountId: record.accountId,
      corpus: "chat",
      sourceLabel: "chat",
      body: text,
      fileId: null,
    });
  }

  const events = await store.listEvents(record.id, record.accountId);
  const first = !events.some((event) => event.role === "assistant");
  const transcript = events
    .filter((event) => event.role === "user")
    .map((event) => event.body)
    .join("\n");
  const urgency = checkUrgency(transcript);

  let confirmed: PendingFact[] = [];
  let usedAsConfirmation = false;
  if (record.pending.length && isYes(text)) {
    confirmed = [...record.pending];
    record.pending = [];
    usedAsConfirmation = true;
  } else if (record.pending.length && isNo(text)) {
    record.rejected.push(...record.pending.map((item) => ({ field: item.field, sourceId: item.sourceId })));
    record.pending = [];
    usedAsConfirmation = true;
  }

  record.facts = nextFacts(factsBefore, extractFacts(transcript, today));
  if (!usedAsConfirmation) record.facts = nextFacts(record.facts, answersToAsked(text, record.asked));
  for (const pending of confirmed) applyPending(record, pending);

  record.category = classifyIssue(transcript);
  const caseFileSearches = await proposeFromFiles(store, record);
  const missing = missingRequirements(record.category as Category, record.facts);
  record.missing = missing;

  const shownConfirmations = record.pending.slice(0, SLOTS);
  const questionFields = missing.filter((field) => !record.pending.some((item) => item.field === field));
  const shownQuestions = questionFields.slice(0, Math.max(0, SLOTS - shownConfirmations.length));
  record.asked = [...shownConfirmations.map((item) => item.field), ...shownQuestions];
  record.updatedAt = now;

  const baseTrace: TracePayload = {
    factsBefore,
    factsAfter: record.facts,
    missing,
    urgency: urgency.level,
    caseFileSearches,
    legalSearches: [],
    dropped: [],
    chunkIds: [],
    retrieved: [],
    model: "none",
    retrieval: "lexical",
    relevance: "unknown",
    warnings: [],
    queryTruncated: false,
    validationProblems: [],
  };

  if (shownConfirmations.length || shownQuestions.length) {
    const followUps = shownQuestions.map((field) => questionFor(field));
    const presented = presentReply(
      [...shownConfirmations.map((item) => confirmationLine(item)), ...followUps].join("\n"),
      { first, urgent: urgency.level === "urgent", referrals: [] },
    );
    await finish(store, record, presented.reply, now, baseTrace);
    return { caseId: record.id, reply: presented.reply, texts: presented.texts, citations: [], followUps, confirmations: shownConfirmations };
  }

  const scope = searchScope(record.facts, record.category);
  const corpus = await store.legalCorpus();
  const search = deps.retrieve ?? retrieveLegal;
  const returned: LegalChunk[] = [];
  const tools = {
    async search(query: string) {
      const found = await search(query, corpus ? { ...scope, chunks: corpus } : scope);
      for (const chunk of found.chunks) {
        if (!returned.some((item) => item.id === chunk.id)) returned.push(chunk);
      }
      return toSearchResult(query, scope, found);
    },
    get(chunkId: string) {
      return Promise.resolve(readReturnedChunk(returned, chunkId, scope));
    },
  };

  let answered;
  try {
    answered = await deps.model.answer({ userText: transcript, searchText: retrievalQuery(transcript), facts: record.facts }, tools);
  } catch (error) {
    const fallback = await tools.search(retrievalQuery(transcript));
    answered = {
      text: fallback.chunks.length ? safeCompose(fallback.chunks) : NOT_COVERED,
      chunks: fallback.chunks,
      searches: fallback.queries,
      retrieval: fallback.retrieval,
      relevance: fallback.relevance,
      warnings: fallback.warnings,
      queryTruncated: fallback.queryTruncated,
    };
    baseTrace.validationProblems.push(error instanceof Error ? error.message : "The model request failed.");
  }

  let draft = answered.text;
  const problems = validateReply(draft, answered.chunks, record.facts);
  if (!draft.trim()) problems.push("The model returned no text.");
  if (problems.length) {
    baseTrace.dropped.push({ text: draft, reason: problems.join("; ") });
    draft = answered.chunks.length ? safeCompose(answered.chunks) : NOT_COVERED;
  }

  const referrals = matchReferrals(await store.referrals(), record.facts, record.category);
  const presented = presentReply(draft, {
    first,
    urgent: urgency.level === "urgent",
    referrals,
    offer: /\b(draft|email|letter)\b/i.test(transcript)
      ? "Want me to change anything in that draft?"
      : offerFor(record.category, record.facts),
  });
  const citations = safeCitations(draft, answered.chunks);
  baseTrace.legalSearches = answered.searches;
  baseTrace.chunkIds = answered.chunks.map((chunk) => chunk.id);
  baseTrace.retrieved = answered.chunks.map((chunk) => ({
    id: chunk.id,
    publisher: chunk.publisher,
    title: chunk.title,
    url: chunk.url,
    body: chunk.body,
  }));
  baseTrace.model = deps.model.id;
  baseTrace.retrieval = answered.retrieval;
  baseTrace.relevance = answered.relevance;
  baseTrace.warnings = answered.warnings;
  baseTrace.queryTruncated = answered.queryTruncated;
  baseTrace.validationProblems = [...baseTrace.validationProblems, ...problems];
  baseTrace.factsAfter = record.facts;
  await finish(store, record, presented.reply, now, baseTrace);
  return { caseId: record.id, reply: presented.reply, texts: presented.texts, citations, followUps: [], confirmations: [] };
}

export async function readDeveloperTrace(store: FelizStore, caseId: string): Promise<TraceRecord[]> {
  return store.traces(caseId);
}

function safeCompose(chunks: LegalChunk[]): string {
  try {
    return composeFromChunks(chunks);
  } catch {
    return NOT_COVERED;
  }
}

function safeCitations(reply: string, chunks: LegalChunk[]): Citation[] {
  try {
    return citationsInReply(reply, chunks).map((chunk) => ({
      chunkId: chunk.id,
      publisher: chunk.publisher,
      title: chunk.title,
      url: chunk.url,
      fetchedAt: chunk.fetchedAt,
      heading: chunk.heading,
    }));
  } catch {
    return [];
  }
}

async function proposeFromFiles(store: FelizStore, record: CaseRecord) {
  const files = (await store.caseChunks(record.id, record.accountId)).filter((chunk) => chunk.corpus === "case_file");
  const missing = missingRequirements(record.category as Category, record.facts);
  const searches = [];
  for (const field of missing) {
    if (field === "whatHappened") continue;
    if (record.pending.some((item) => item.field === field)) {
      const pending = record.pending.find((item) => item.field === field);
      searches.push({ field, sourceLabel: pending?.sourceLabel ?? null, proposed: pending?.value ?? null });
      continue;
    }
    let proposed: string | null = null;
    let sourceLabel: string | null = null;
    let sourceId: string | null = null;
    for (const chunk of files) {
      if (record.rejected.some((item) => item.field === field && item.sourceId === chunk.id)) continue;
      const value = proposeField(field, chunk.body);
      if (value == null) continue;
      proposed = value;
      sourceLabel = chunk.sourceLabel;
      sourceId = chunk.id;
      break;
    }
    searches.push({ field, sourceLabel, proposed });
    if (proposed && sourceLabel && sourceId) {
      record.pending.push({ field: field as keyof CaseFacts, value: proposed, sourceLabel, sourceId });
    }
  }
  return searches;
}

function applyPending(record: CaseRecord, pending: PendingFact) {
  if (pending.field === "amountWithheld" || pending.field === "depositAmount") {
    record.facts[pending.field] = Number(pending.value);
    return;
  }
  if (pending.field === "itemizedStatement") {
    record.facts.itemizedStatement = pending.value === "no" ? "no" : "yes";
    return;
  }
  if (pending.field === "city") {
    record.facts.city = pending.value;
    record.facts.unincorporated = false;
    const county = countyFor(pending.value);
    if (county) record.facts.county = county;
    return;
  }
  if (pending.field === "moveOutDate") record.facts.moveOutDate = pending.value;
  if (pending.field === "noticeDate") record.facts.noticeDate = pending.value;
  if (pending.field === "county") record.facts.county = pending.value;
  if (pending.field === "unincorporated") record.facts.unincorporated = pending.value === "true";
}

async function finish(store: FelizStore, record: CaseRecord, reply: string, now: string, payload: TracePayload) {
  record.updatedAt = now;
  await store.saveCase(record);
  await store.addEvent({
    id: createId("event"),
    caseId: record.id,
    accountId: record.accountId,
    role: "assistant",
    body: reply,
    createdAt: now,
  });
  await store.addTrace({
    id: createId("trace"),
    caseId: record.id,
    accountId: record.accountId,
    createdAt: now,
    payload,
  });
}

export type { Requirement };
