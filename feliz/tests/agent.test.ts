import type { LegalChunk } from "@feliz/db";
import { createMemoryStore } from "../packages/db/src/memory.js";
import { chunkApplies, type RetrieveOptions, type RetrieveResult } from "../packages/rag/src/index.js";
import { handleTurn, readDeveloperTrace } from "../packages/agent/src/agent.js";
import { GeminiModel, GroundedModel, buildGenerateRequest } from "../packages/agent/src/gemini.js";
import type { LanguageModel } from "../packages/agent/src/gemini.js";
import { handleIncoming } from "../apps/bot/src/message-handler.js";
import { expect, test } from "vitest";

const DEPOSIT: LegalChunk = {
  id: "chunk_deposit_return",
  documentId: "doc_lahd_deposit",
  chunkIndex: 0,
  publisher: "Los Angeles Housing Department",
  title: "Security deposit returns",
  url: "https://housing.lacity.gov/residents/security-deposits",
  fetchedAt: "2026-10-17",
  heading: "Return deadline",
  body: "After a tenant moves out, the landlord has 21 days to return the security deposit or to send an itemized statement of deductions.",
  state: "CA",
  county: "Los Angeles",
  city: "Los Angeles",
  topics: ["security_deposit"],
  embedding: null,
  embeddingModel: null,
};

const COUNTY_ONLY: LegalChunk = {
  ...DEPOSIT,
  id: "chunk_county_rstpo",
  documentId: "doc_county",
  title: "County rent stabilization",
  url: "https://dcba.lacounty.gov/rentstabilizationprogram/",
  heading: "Unincorporated county",
  body: "The county rent stabilization program applies in unincorporated Los Angeles County.",
  city: null,
  topics: ["rent_increase"],
  unincorporatedOnly: true,
};

function fakeRetrieve(chunks: LegalChunk[], seen: RetrieveOptions[]) {
  return async (query: string, options: RetrieveOptions): Promise<RetrieveResult> => {
    seen.push(options);
    const hits = chunks.filter((chunk) => chunkApplies(chunk, options) && query.trim().length > 0);
    return {
      chunks: hits.map((chunk) => ({ ...chunk, score: 1, similarity: null })),
      retrieval: "lexical",
      status: hits.length ? "ok" : "no_evidence",
      relevance: "weak",
      topSimilarity: null,
      topicSimilarity: null,
      queryTruncated: false,
      warnings: [],
    };
  };
}

const NOW = "2026-10-17T12:00:00.000Z";
const DEPOSIT_STORY =
  "My landlord kept $800 of my security deposit. I moved out September 1, 2026. The apartment is in Los Angeles. They never sent an itemized list.";

test("a deposit without a city asks and does not search", async () => {
  const store = createMemoryStore();
  await store.insertLegalChunk(DEPOSIT);
  const seen: RetrieveOptions[] = [];
  const account = await store.upsertAccount("+13105550100");
  const record = await store.createCase(account.id);
  const turn = await handleTurn(
    store,
    { accountId: account.id, caseId: record.id, message: "My landlord kept $800 of my security deposit." },
    { model: new GroundedModel(), retrieve: fakeRetrieve([DEPOSIT], seen), now: NOW },
  );
  expect(seen).toEqual([]);
  expect(turn.reply).toContain("Which city is the rental in?");
  expect(turn.reply).toContain("This is legal information and navigation, not legal advice or representation.");
  expect(turn.reply).not.toContain("21 days");
  expect(turn.citations).toEqual([]);
});

test("a complete Los Angeles deposit searches with scope and keeps a weak match", async () => {
  const store = createMemoryStore();
  await store.insertLegalChunk(DEPOSIT);
  const seen: RetrieveOptions[] = [];
  const account = await store.upsertAccount("+13105550100");
  const record = await store.createCase(account.id);
  const turn = await handleTurn(
    store,
    { accountId: account.id, caseId: record.id, message: DEPOSIT_STORY },
    { model: new GroundedModel(), retrieve: fakeRetrieve([DEPOSIT], seen), now: NOW },
  );
  expect(seen[0]).toMatchObject({
    state: "CA",
    county: "Los Angeles",
    city: "Los Angeles",
    topic: "security_deposit",
    unincorporated: false,
  });
  expect(turn.reply).toContain("21 days");
  expect(turn.reply).toContain('Source: Los Angeles Housing Department, "Security deposit returns", https://housing.lacity.gov/residents/security-deposits, fetched 2026-10-17. Section: Return deadline.');
  expect(turn.reply).toContain("Referral only.");
  expect(turn.reply).toContain("https://dcba.lacounty.gov/");
  expect(turn.citations).toHaveLength(1);
  const traces = await readDeveloperTrace(store, record.id);
  expect(traces[0]?.payload.relevance).toBe("weak");
  expect(traces[0]?.payload.chunkIds).toEqual(["chunk_deposit_return"]);
  expect(JSON.stringify(turn)).not.toContain("legalSearches");
});

test("an unincorporated renter can see a county-only page", async () => {
  const store = createMemoryStore();
  await store.insertLegalChunk(COUNTY_ONLY);
  const seen: RetrieveOptions[] = [];
  const account = await store.upsertAccount("+13105550101");
  const record = await store.createCase(account.id);
  const turn = await handleTurn(
    store,
    {
      accountId: account.id,
      caseId: record.id,
      message: "My landlord raised the rent. The rental is in unincorporated Los Angeles County.",
    },
    { model: new GroundedModel(), retrieve: fakeRetrieve([COUNTY_ONLY], seen), now: NOW },
  );
  expect(seen[0]).toMatchObject({ state: "CA", county: "Los Angeles", city: null, topic: "rent_increase", unincorporated: true });
  expect(turn.reply).toContain("unincorporated Los Angeles County");
  expect(turn.citations).toHaveLength(1);
});

test("a bad draft is replaced and a lockout stays urgent without a citation yet", async () => {
  const store = createMemoryStore();
  await store.insertLegalChunk(DEPOSIT);
  const account = await store.upsertAccount("+13105550102");
  const record = await store.createCase(account.id);
  const bad: LanguageModel = {
    id: "bad-model",
    async answer(_input, tools) {
      const found = await tools.search("security deposit");
      return {
        text: 'You will win $99999.\nSource: Invented Agency, "Fake", https://example.com/nope, fetched 1999-01-01. Section: None.',
        chunks: found.chunks,
        searches: found.queries,
        retrieval: found.retrieval,
        relevance: found.relevance,
        warnings: found.warnings,
        queryTruncated: found.queryTruncated,
      };
    },
  };
  const turn = await handleTurn(
    store,
    { accountId: account.id, caseId: record.id, message: DEPOSIT_STORY },
    { model: bad, retrieve: fakeRetrieve([DEPOSIT], []), now: NOW },
  );
  expect(turn.reply).not.toContain("You will win");
  expect(turn.reply).not.toContain("99999");
  expect(turn.reply).toContain("https://housing.lacity.gov/residents/security-deposits");
  const traces = await readDeveloperTrace(store, record.id);
  expect(traces[0]?.payload.dropped[0]?.text).toContain("You will win");

  const urgent = await handleIncoming(store, new GroundedModel(), {
    phone: "+13105550103",
    message: "I got an eviction notice and the landlord locked me out.",
  });
  expect(urgent.reply).toContain("This sounds time-sensitive.");
  expect(urgent.reply).toContain("Which city is the rental in?");
  expect(urgent.reply).not.toContain("Source:");
});

test("incoming messages stay on the phone's case", async () => {
  const store = createMemoryStore();
  const first = await handleIncoming(store, new GroundedModel(), { phone: "+13105550100", message: "My landlord is being unfair." });
  const second = await handleIncoming(store, new GroundedModel(), { phone: "+13105550100", message: "It is the deposit." });
  expect(second.caseId).toBe(first.caseId);
  await expect(handleIncoming(store, new GroundedModel(), { phone: "+13105550777", message: "Hello", caseId: first.caseId })).rejects.toThrow(
    "Case not found.",
  );
});

test("gemini keeps the function call id and does not send temperature", async () => {
  const bodies: string[] = [];
  const responses = [
    { candidates: [{ content: { parts: [{ functionCall: { name: "search_documents", id: "abc", args: { query: "deposit deadline" } } }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'After a tenant moves out, the landlord has 21 days to return the security deposit or to send an itemized statement of deductions.\nSource: Los Angeles Housing Department, "Security deposit returns", https://housing.lacity.gov/residents/security-deposits, fetched 2026-10-17. Section: Return deadline.',
              },
            ],
          },
        },
      ],
    },
  ];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    const next = responses.shift();
    return new Response(JSON.stringify(next), { status: 200 });
  };
  const store = createMemoryStore();
  await store.insertLegalChunk(DEPOSIT);
  const account = await store.upsertAccount("+13105550104");
  const record = await store.createCase(account.id);
  const turn = await handleTurn(
    store,
    { accountId: account.id, caseId: record.id, message: DEPOSIT_STORY },
    { model: new GeminiModel("test-key", fetchImpl as typeof fetch), retrieve: fakeRetrieve([DEPOSIT], []), now: NOW },
  );
  expect(turn.reply).toContain("21 days");
  expect(bodies[0]).not.toContain("temperature");
  expect(bodies[1]).toContain("abc");
  const request = buildGenerateRequest("system", []);
  expect(request.generationConfig).not.toHaveProperty("temperature");
});
