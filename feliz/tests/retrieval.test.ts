import { expect, test } from "vitest";
import type { LegalChunk } from "@feliz/db";
import { EMBEDDING_MODEL, rankLegalChunks, sourceLine, citationsInReply } from "@feliz/rag";
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
  const rows = rankLegalChunks([chunk("semantic", { body: "Reimbursement for tenancy funds.", title: "Money", heading: "Returns" }), chunk("foreign", { body: "Nothing", title: "Nothing", heading: "Nothing", embeddingModel: "gemini-embedding-001" })], "security deposit", { state: "CA", queryEmbedding: vector(0) });
  expect(rows.map((c) => c.id)).toEqual(["semantic"]);
});
test("citation matching accepts only evidence from the current turn", () => {
  const c = chunk("a");
  expect(citationsInReply(`A quote\n${sourceLine(c)}`, [c])[0].id).toBe("a");
  expect(() => citationsInReply(sourceLine(chunk("b")), [c])).toThrow("not returned");
});
