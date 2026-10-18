import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LegalChunk, LegalSource } from "@feliz/db";

// Real scraped pages: tenant harassment (City of LA, mojibake, an outdated deadline),
// the LawHelpCA housing index (navigation, the 10-court-day rule), LAFLA locations (time ranges).
const FIXTURE = "tests/fixtures/documents.sample.jsonl";

// In-memory stand-in for Supabase, so ingest() runs without keys. Rows go through the real
// column mapping (legalChunkRow / legalSourceRow) so the schema contract below is checked too.
const store = {
  sources: new Map<string, Record<string, unknown>>(),
  chunks: new Map<string, Record<string, unknown>>(),
};
vi.mock("@feliz/db", async () => {
  const real = await vi.importActual<typeof import("@feliz/db")>("@feliz/db");
  return {
    ...real,
    upsertLegalSources: async (rows: LegalSource[]) => rows.forEach((r) => store.sources.set(r.documentId, real.legalSourceRow(r))),
    upsertLegalChunks: async (rows: LegalChunk[]) => {
      for (const r of rows) {
        if (!store.sources.has(r.documentId)) throw new Error("foreign key: legal_sources row missing");
        store.chunks.set(r.id, real.legalChunkRow(r));
      }
    },
    deleteStaleLegalChunks: async (documentId: string, keep: string[]) => {
      for (const [id, c] of store.chunks) if (c.document_id === documentId && !keep.includes(id)) store.chunks.delete(id);
    },
    loadedState: async () => {
      const m = new Map<string, { contentHash: string; chunkCount: number; embeddingModels: (string | null)[] }>();
      for (const [id, s] of store.sources) {
        m.set(id, { contentHash: s.content_hash as string, chunkCount: [...store.chunks.values()].filter((c) => c.document_id === id).length, embeddingModels: [...store.chunks.values()].filter((c) => c.document_id === id).map((c) => c.embedding_model as string | null) });
      }
      return m;
    },
  };
});

const embeddingMock = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../apps/ingest/src/embed.js", () => ({
  embedChunks: async (chunks: unknown[]) => {
    embeddingMock.calls++;
    return chunks.map(() => Array.from({ length: 768 }, (_, i) => Number(i === 0)));
  },
}));
const { parseJsonl, parseDocument, fixMojibake } = await import("../apps/ingest/src/parser.js");
const { buildLegalChunks, ingest } = await import("../apps/ingest/src/index.js");

const docs = parseJsonl(readFileSync(FIXTURE, "utf8")).map(parseDocument);
const chunks = docs.flatMap(buildLegalChunks);
const byUrl = (part: string) => chunks.filter((c) => c.url.includes(part));

// docs/rag-supabase.md: citationsInReply() parses exactly this.
const SOURCE_LINE = /^Source: (.+?), "(.+?)", (\S+), fetched (\d{4}-\d{2}-\d{2})\. Section: (.+)\.$/;
const sourceLine = (c: LegalChunk) => `Source: ${c.publisher}, "${c.title}", ${c.url}, fetched ${c.fetchedAt}. Section: ${c.heading}.`;

describe("chunks meet the legal_chunks contract", () => {
  test("ids are {documentId}_{index} from 0, in order", () => {
    for (const doc of docs) {
      const ids = chunks.filter((c) => c.documentId === doc.documentId).map((c) => c.id);
      expect(ids).toEqual(ids.map((_, i) => `${doc.documentId}_${i}`));
    }
  });

  test("every chunk's Source line parses back to the same fields", () => {
    for (const c of chunks) {
      const m = SOURCE_LINE.exec(sourceLine(c));
      expect(m, sourceLine(c)).not.toBeNull();
      expect(m!.slice(1)).toEqual([c.publisher, c.title, c.url, c.fetchedAt, c.heading]);
    }
  });

  test("bodies are quotable: sized, no boilerplate, no mojibake", () => {
    for (const c of chunks) {
      expect(c.body.length).toBeGreaterThanOrEqual(60);
      expect(c.body.length).toBeLessThanOrEqual(1000);
      expect(c.body).not.toMatch(/Skip to content|Search for Your Issue|Featured Guides|Notice All LAFLA|Ã|â/);
    }
  });

  test("tags follow each page's scope", () => {
    expect(byUrl("tenant-harassment").every((c) => c.city === "Los Angeles" && c.topics.join() === "eviction")).toBe(true);
    expect(byUrl("lawhelpca").every((c) => c.city === null && c.state === "CA")).toBe(true);
    expect(chunks.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.fetchedAt) && c.embedding === null)).toBe(true);
  });

  test("headings come from the page's own questions", () => {
    const h = byUrl("tenant-harassment").map((c) => c.heading);
    expect(h).toContain("What is harassment?");
    expect(h).toContain("What can I do if my landlord is harassing me?");
    // A question heading doesn't run on over unrelated text: long stretches fall back to the title.
    let longest = 0;
    let run = 0;
    h.forEach((x, i) => {
      run = x !== "Tenant Harassment" && x === h[i - 1] ? run + 1 : 1;
      if (x !== "Tenant Harassment") longest = Math.max(longest, run);
    });
    expect(longest).toBeLessThanOrEqual(3);
  });
});

describe("accuracy", () => {
  test("the outdated 5-day eviction answer deadline is removed", () => {
    expect(chunks.some((c) => /only have 5 days to answer/i.test(c.body))).toBe(false);
    expect(byUrl("tenant-harassment").some((c) => /affirmative defense/.test(c.body))).toBe(true); // rest of the page kept
  });

  test("the 10-court-day rule stays in one chunk with its qualifier", () => {
    const c = chunks.find((x) => x.body.includes("10 court days"))!;
    expect(c.body).toContain("(AB 2347)");
    expect(c.body).toContain("that is no longer California law");
  });

  test("mojibake is repaired by position", () => {
    expect(fixMojibake("Monday â Friday | 9 a.m.â5 p.m. and 1:00â4:00")).toBe("Monday – Friday | 9 a.m.–5 p.m. and 1:00–4:00");
    expect(fixMojibake("driverâs license, âpeace and quiet enjoymentâ")).toBe("driver's license, 'peace and quiet enjoyment'");
    expect(byUrl("locations")[0].body).toContain("9 a.m.–5 p.m.");
  });

  test("publisher comes from the site, not the scraper's crawl-seed label", () => {
    expect(byUrl("lafla.org").every((c) => c.publisher === "Legal Aid Foundation of Los Angeles")).toBe(true);
    const raw = parseJsonl(readFileSync(FIXTURE, "utf8")).find((d) => d.source_url.includes("lafla"))!;
    expect(raw.source_name).toBe("LAFLA Eviction Defense"); // what the scraper wrote
    const moved = parseDocument({ ...raw, source_name: "LawHelpCA Housing Rights" });
    expect(moved.publisher).toBe("Legal Aid Foundation of Los Angeles");
  });

  test("an untagged page is refused rather than guessed", () => {
    const doc = parseJsonl(readFileSync(FIXTURE, "utf8"))[0];
    expect(() => parseDocument({ ...doc, source_url: "https://example.com/new-page" })).toThrow("No PAGE_TAGS entry");
  });
});

describe("ingest()", () => {
  let embedCalls = 0;
  beforeEach(() => {
    store.chunks.clear();
    store.sources.clear();
    embedCalls = 0;
    embeddingMock.calls = 0;
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      embedCalls++;
      const n = JSON.parse(init.body as string).requests.length;
      const embeddings = Array.from({ length: n }, () => ({ values: Array.from({ length: 768 }, (_, j) => (j === 0 ? 1 : 0)) }));
      return new Response(JSON.stringify({ embeddings }));
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("loads every chunk with a 768-d embedding, then skips unchanged pages", async () => {
    await ingest(FIXTURE);
    expect(store.chunks.size).toBe(chunks.length);
    const rows = [...store.chunks.values()];
    expect(rows.every((c) => typeof c.embedding === "string" && (c.embedding as string).split(",").length === 768)).toBe(true);
    expect(rows.every((c) => c.embedding_model === "gemini-embedding-001")).toBe(true);
    expect(store.sources.size).toBe(docs.length);

    const calls = embeddingMock.calls;
    await ingest(FIXTURE);
    expect(embeddingMock.calls).toBe(calls); // nothing re-embedded
  });

  test("--no-embed writes chunks without running local inference", async () => {
    await ingest(FIXTURE, { noEmbed: true });
    expect(embeddingMock.calls).toBe(0);
    expect(store.chunks.size).toBe(chunks.length);
    expect([...store.chunks.values()].every((c) => c.embedding === null && c.embedding_model === null)).toBe(true);
  });

  test("a normal run replaces null or old-model vectors even when text is unchanged", async () => {
    await ingest(FIXTURE, { noEmbed: true });
    expect(embeddingMock.calls).toBe(0);
    await ingest(FIXTURE);
    expect(embeddingMock.calls).toBeGreaterThan(0);
    for (const row of store.chunks.values()) row.embedding_model = "Xenova/multilingual-e5-base";
    const previous = embeddingMock.calls;
    await ingest(FIXTURE);
    expect(embeddingMock.calls).toBeGreaterThan(previous);
    expect([...store.chunks.values()].every((c) => c.embedding_model === "gemini-embedding-001")).toBe(true);
  });

  test("a page that got shorter loses its stale chunks", async () => {
    await ingest(FIXTURE);
    const doc = docs[0];
    store.chunks.set(`${doc.documentId}_999`, { ...[...store.chunks.values()][0], id: `${doc.documentId}_999`, document_id: doc.documentId });
    await ingest(FIXTURE, { force: true });
    expect(store.chunks.has(`${doc.documentId}_999`)).toBe(false);
    expect(store.chunks.size).toBe(chunks.length);
  });
});

describe("rows match the Supabase schema (snapshot of the team's tables, 2026-10-17)", () => {
  // From the project's PostgREST schema. * = NOT NULL without a default.
  const LEGAL_CHUNKS = "id* document_id* chunk_index* publisher* title* url* fetched_at* heading* body* page_number state county city topics* embedding embedding_model";
  const LEGAL_SOURCES = "document_id* source_url* publisher* title* content_type* content_hash* extracted_text* storage_path last_fetched_at* metadata* created_at";
  const check = (row: Record<string, unknown>, spec: string) => {
    const cols = spec.split(" ");
    const known = cols.map((c) => c.replace("*", ""));
    for (const key of Object.keys(row)) expect(known, `unknown column ${key}`).toContain(key);
    for (const c of cols.filter((c) => c.endsWith("*")).map((c) => c.slice(0, -1))) {
      expect(row[c], `required column ${c}`).not.toBeNull();
      expect(row[c], `required column ${c}`).not.toBeUndefined();
    }
  };

  test("legal_chunks rows", async () => {
    const { legalChunkRow } = await vi.importActual<typeof import("@feliz/db")>("@feliz/db");
    for (const c of chunks) check(legalChunkRow(c), LEGAL_CHUNKS);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((c) => Number(c.id.split("_").pop())));
  });

  test("legal_sources rows", async () => {
    const { legalSourceRow } = await vi.importActual<typeof import("@feliz/db")>("@feliz/db");
    const { buildLegalSource } = await import("../apps/ingest/src/index.js");
    for (const d of docs) check(legalSourceRow(buildLegalSource(d)), LEGAL_SOURCES);
  });
});
