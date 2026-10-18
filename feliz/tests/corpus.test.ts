import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseJsonl, parseDocument } from "../apps/ingest/src/parser.js";
import { buildLegalChunks } from "../apps/ingest/src/index.js";
test("latest 52-page scraper corpus is accepted with bounded chunks and applicability flags", () => {
  const docs = parseJsonl(readFileSync("apps/ingest/webscraper/data/processed/documents.jsonl", "utf8")).map(parseDocument);
  expect(docs).toHaveLength(52);
  const chunks = docs.flatMap(buildLegalChunks);
  expect(chunks.length).toBeGreaterThan(400);
  expect(chunks.every((c) => c.body.length >= 60 && c.body.length <= 1000)).toBe(true);
  expect(chunks.some((c) => c.url.includes("guide-security-deposits-california"))).toBe(true);
  expect(chunks.filter((c) => c.url.endsWith(".pdf")).every((c) => c.reviewRequired)).toBe(true);
  expect(chunks.filter((c) => c.url.includes("rentstabilizationprogram")).every((c) => c.unincorporatedOnly)).toBe(true);
});
