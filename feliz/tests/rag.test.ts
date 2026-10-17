import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SearchRow } from "@feliz/db";
import { selectPassages, usedCitations } from "@feliz/rag";

// Runs the real Supabase migration in an in-process Postgres, so hybrid_search
// is tested without a Supabase project or an OpenAI key.

const DIM = 1536;
/** Unit vector pointing mostly along `axis`, with a little of `blend` mixed in. */
function vec(axis: number, blend?: number, amount = 0): string {
  const v = new Array(DIM).fill(0);
  v[axis] = 1 - amount;
  if (blend !== undefined) v[blend] = amount;
  const norm = Math.hypot(...v);
  return `[${v.map((x) => x / norm).join(",")}]`;
}

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { vector } });
  await db.exec(await readFile("supabase/migrations/20261017000000_rag_documents.sql", "utf8"));
  const docs = [
    // id, source, url, content, jurisdictions, authority, embedding
    ["deposit-statute", "statutes", "https://leg/1950.5", "A landlord must return the security deposit within 21 days with an itemized statement.", ["california"], 1, vec(0)],
    ["deposit-guide", "lawhelpca", "https://lawhelp/deposit", "Getting your security deposit back after you move out.", ["california"], 3, vec(0, 1, 0.3)],
    ["rso-city", "lahd", "https://lahd/rso", "The Rent Stabilization Ordinance limits rent increases for units built before October 1978.", ["city_of_la"], 2, vec(2)],
    ["county-rent", "dcba", "https://dcba/rent", "Unincorporated LA County rent stabilization program and allowable increases.", ["la_county"], 2, vec(2, 3, 0.2)],
    ["lockout", "courts", "https://courts/lockout", "A landlord cannot change the locks or remove belongings without a court order. Lockouts are illegal.", ["california"], 2, vec(4)],
  ] as const;
  for (const [id, source, url, content, jurisdictions, authority, embedding] of docs) {
    await db.query(
      `insert into rag_documents (id, source, source_name, url, content, jurisdictions, authority, embedding)
       values ($1, $2, $2, $3, $4, $5, $6, $7::vector)`,
      [id, source, url, content, jurisdictions, authority, embedding],
    );
  }
});

afterAll(() => db.close());

async function search(text: string, embedding: string, jurisdictions: string[] | null = null) {
  const { rows } = await db.query<SearchRow>(
    "select * from hybrid_search($1, $2::vector, 5, $3::text[])",
    [text, embedding, jurisdictions],
  );
  return rows;
}

describe("hybrid_search", () => {
  test("ranks the closest passage first and reports its similarity", async () => {
    const rows = await search("security deposit returned", vec(0));
    expect(rows[0].id).toBe("deposit-statute");
    expect(rows[0].similarity).toBeCloseTo(1, 5);
    expect(rows.map((r) => r.id)).toContain("deposit-guide");
  });

  test("jurisdiction filter excludes other cities' rules but keeps statewide law", async () => {
    const rows = await search("rent increase limits", vec(2), ["la_county", "california"]);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("county-rent");
    expect(ids).not.toContain("rso-city");
    expect(rows.every((r) => r.jurisdictions.some((j) => ["la_county", "california"].includes(j)))).toBe(true);
  });

  test("keyword match lifts a passage the vector search ranked low", async () => {
    // Embedding points at the deposit docs, but the words match the lockout passage.
    const withKeywords = await search("locks changed lockout court order", vec(0));
    const withoutKeywords = await search("zzz", vec(0));
    const rank = (rows: SearchRow[]) => rows.findIndex((r) => r.id === "lockout");
    expect(rank(withKeywords)).toBeLessThan(rank(withoutKeywords));
  });

  test("a question of only stopwords still returns vector results", async () => {
    const rows = await search("the and of", vec(4));
    expect(rows[0].id).toBe("lockout");
  });
});

describe("selectPassages", () => {
  const row = (id: string, url: string, score: number, similarity: number | null): SearchRow => ({
    id, url, score, similarity, source: "s", source_name: "S", title: null, content: id,
    jurisdictions: ["california"], authority: 3,
  });

  test("caps passages per URL and sorts by score", () => {
    const { passages } = selectPassages(
      [row("a1", "a", 0.9, 0.6), row("a2", "a", 0.8, 0.5), row("a3", "a", 0.7, 0.5), row("b1", "b", 0.6, 0.4)],
      { k: 5, perUrl: 2 },
    );
    expect(passages.map((p) => p.id)).toEqual(["a1", "a2", "b1"]);
  });

  test("confidence follows the best similarity", () => {
    expect(selectPassages([row("x", "x", 1, 0.7)]).confidence).toBe("high");
    expect(selectPassages([row("x", "x", 1, 0.4)]).confidence).toBe("low");
    expect(selectPassages([row("x", "x", 1, 0.1)]).confidence).toBe("none");
    expect(selectPassages([]).confidence).toBe("none");
  });

  test("usedCitations returns only cited sources, once per URL", () => {
    const passages = [row("a", "https://a", 1, 1), row("b", "https://b", 1, 1), row("a2", "https://a", 1, 1)];
    const cited = usedCitations("Deposit back in 21 days [1][3]. Also see [1].", passages);
    expect(cited.map((c) => c.url)).toEqual(["https://a"]);
  });
});

test("authority breaks ties but never outranks a closer match", async () => {
  // deposit-statute (authority 1) is orthogonal to this query; lockout (authority 2) matches exactly.
  const { rows } = await db.query<SearchRow>("select * from hybrid_search('zzz', $1::vector, 5, null)", [vec(4)]);
  expect(rows[0].id).toBe("lockout");
});
