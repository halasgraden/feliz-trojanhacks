import { beforeEach, describe, expect, test, vi } from "vitest";
const db = vi.hoisted(() => ({ calls: 0, rows: [] as unknown[] }));
vi.mock("@feliz/db", () => ({ listLegalChunks: async () => { db.calls++; return db.rows; } }));
const model = vi.hoisted(() => ({ fail: false }));
vi.mock("../packages/rag/src/embed.js", async (orig) => {
  const real = await orig<typeof import("../packages/rag/src/embed.js")>();
  const unit = (axis: number) => Array.from({ length: 768 }, (_, i) => Number(i === axis));
  return {
    ...real,
    // Axis 0 = "housing" direction; anything mentioning pizza points elsewhere.
    embedQuery: async (q: string) => { if (model.fail) throw new Error("model unavailable"); return unit(/pizza/i.test(q) ? 5 : 0); },
  };
});
import type { LegalChunk } from "@feliz/db";
import { EMBEDDING_MODEL, rankLegalChunks, sourceLine, citationsInReply } from "../packages/rag/src/index.js";
import { retrieve, clearCorpusCache } from "../packages/rag/src/retrieve.js";
const vector = (axis: number) => Array.from({ length: 768 }, (_, i) => Number(i === axis));
const chunk = (id: string, extra: Partial<LegalChunk> = {}): LegalChunk => ({
  id, documentId: id, chunkIndex: 0, publisher: "Courts", title: "Deposits", url: "https://courts.example/" + id,
  fetchedAt: "2026-10-17", heading: "Returns", body: "The security deposit must be returned with any itemized deductions.",
  state: "CA", county: null, city: null, topics: ["security_deposit"], embedding: vector(0), embeddingModel: EMBEDDING_MODEL, ...extra,
});
test("filters location, topic, review holds and unincorporated scope before ranking", () => {
  const input = [chunk("state"), chunk("city", { city: "Los Angeles" }), chunk("county", { county: "Los Angeles", unincorporatedOnly: true }), chunk("review", { reviewRequired: true }), chunk("topic", { topics: ["eviction"] })];
  const opts = { state: "CA", county: "Los Angeles", city: "Santa Monica", topic: "security_deposit" as const, queryEmbedding: vector(0) };
  expect(rankLegalChunks(input, "deposit", opts).map((c) => c.id)).toEqual(["state"]);
  expect(rankLegalChunks(input, "deposit", { ...opts, unincorporated: true }).map((c) => c.id)).toContain("county");
  expect(rankLegalChunks(input, "deposit")).toEqual([]);
});
test("semantic matches work without word overlap and foreign-model vectors never score", () => {
  const rows = rankLegalChunks([chunk("semantic", { body: "Reimbursement for tenancy funds.", title: "Money", heading: "Returns" }), chunk("foreign", { body: "Nothing", title: "Nothing", heading: "Nothing", embeddingModel: "Xenova/multilingual-e5-base" })], "security deposit", { state: "CA", queryEmbedding: vector(0) });
  expect(rows.map((c) => c.id)).toEqual(["semantic"]);
});
test("citation matching accepts only evidence from the current turn", () => {
  const c = chunk("a");
  expect(citationsInReply(`A quote\n${sourceLine(c)}`, [c])[0].id).toBe("a");
  expect(() => citationsInReply(sourceLine(chunk("b")), [c])).toThrow("not returned");
});

test("place names match regardless of case and spacing", () => {
  const input = [chunk("city", { city: "Los Angeles", county: "Los Angeles" })];
  const hit = (city: string) => rankLegalChunks(input, "deposit", { state: "ca", county: " los angeles", city, queryEmbedding: vector(0) }).length;
  expect(hit("los  angeles")).toBe(1);
  expect(hit("LOS ANGELES")).toBe(1);
  expect(hit("Santa Monica")).toBe(0);
});

describe("retrieve()", () => {
  beforeEach(() => { db.calls = 0; db.rows = [chunk("a")]; model.fail = false; clearCorpusCache(); });

  test("reports relevance, similarity and truncation alongside the passages", async () => {
    const r = await retrieve("security deposit", { state: "CA" });
    expect(r).toMatchObject({ status: "ok", retrieval: "hybrid", relevance: "strong", queryTruncated: false, warnings: [] });
    expect(r.topSimilarity).toBeCloseTo(1);
    expect((await retrieve("best pizza", { state: "CA" })).relevance).toBe("weak");
  });

  test("loads the corpus once and reuses it within the cache window", async () => {
    await retrieve("deposit", { state: "CA" });
    await retrieve("deposit", { state: "CA" });
    expect(db.calls).toBe(1);
    await retrieve("deposit", { state: "CA", cacheTtlMs: 0 });
    expect(db.calls).toBe(2);
  });

  test("falls back to keyword search if the embedding model fails, instead of failing the turn", async () => {
    model.fail = true;
    const r = await retrieve("security deposit", { state: "CA" });
    expect(r).toMatchObject({ status: "ok", retrieval: "lexical", relevance: "unknown" });
    expect(r.warnings[0]).toContain("model unavailable");
  });
});
