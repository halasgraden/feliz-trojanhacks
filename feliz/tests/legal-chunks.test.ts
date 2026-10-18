import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, expect, test } from "vitest";

// Runs the real migration in an in-process Postgres with pgvector.
const MIGRATION = "supabase/migrations/20261017000100_legal_chunks.sql";
let db: PGlite;

const insert = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: "doc_0", document_id: "doc", publisher: "LAFLA", title: "Tenant Harassment",
    url: "https://lafla.org/get-help/tenant-harassment/", fetched_at: "2026-10-18",
    heading: "What is harassment?", body: "A tenant has a legal right to peace and quiet.",
    topics: ["eviction"], embedding: null as string | null, ...overrides,
  };
  return db.query(
    `insert into legal_chunks (id, document_id, publisher, title, url, fetched_at, heading, body, topics, embedding)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector)`,
    [row.id, row.document_id, row.publisher, row.title, row.url, row.fetched_at, row.heading, row.body, row.topics, row.embedding],
  );
};

beforeAll(async () => {
  db = await PGlite.create({ extensions: { vector } });
  await db.exec(await readFile(MIGRATION, "utf8"));
});
afterAll(() => db.close());

test("migration is idempotent", async () => {
  await expect(db.exec(await readFile(MIGRATION, "utf8"))).resolves.toBeDefined();
});

test("accepts a valid chunk, with or without an embedding", async () => {
  await insert();
  await insert({ id: "doc_1", embedding: `[${Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]` });
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from legal_chunks");
  expect(rows[0].n).toBe(2);
});

test("rejects rows whose Source line could not be parsed, or unknown topics", async () => {
  await expect(insert({ id: "bad_1", title: 'The "new" law' })).rejects.toThrow(/title_no_double_quote/);
  await expect(insert({ id: "bad_2", url: "https://x.org/a b" })).rejects.toThrow(/url_no_whitespace/);
  await expect(insert({ id: "bad_3", topics: ["repairs"] })).rejects.toThrow(/topics_known/);
  await expect(insert({ id: "bad_4", embedding: "[1,2,3]" })).rejects.toThrow(/dimensions/);
});

test("HNSW index serves nearest-neighbour search over embeddings", async () => {
  const rand = () => {
    const v = Array.from({ length: 768 }, () => Math.random() - 0.5);
    const n = Math.hypot(...v);
    return `[${v.map((x) => x / n).join(",")}]`;
  };
  for (let i = 0; i < 200; i++) await insert({ id: `r_${i}`, document_id: "r", embedding: rand() });
  await db.exec("analyze legal_chunks; set enable_seqscan = off");
  const plan = await db.query<Record<string, string>>(
    "explain select id from legal_chunks order by embedding <=> $1::vector limit 5", [rand()]);
  expect(plan.rows.map((r) => Object.values(r)[0]).join("\n")).toContain("legal_chunks_embedding_idx");
  await db.exec("reset enable_seqscan");
});
