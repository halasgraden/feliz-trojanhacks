import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { embedDocuments, embedQuery, EMBEDDING_DIMENSIONS } from "@feliz/rag";

// Fakes the Gemini API, so these run without a GEMINI_API_KEY.
let requests: { url: string; headers: Record<string, string>; body: any }[];

beforeEach(() => {
  requests = [];
  process.env.GEMINI_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push({ url, headers: init.headers as Record<string, string>, body });
    // Unnormalized vectors whose first value identifies the input, to check order.
    const embeddings = body.requests.map((_: unknown, i: number) => ({
      values: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, j) => (j === 0 ? 3 + i : j === 1 ? 4 : 0)),
    }));
    return new Response(JSON.stringify({ embeddings }), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

test("queries and documents use Gemini's retrieval prefixes", async () => {
  await embedQuery("can my landlord keep my deposit?");
  await embedDocuments([{ title: "Security deposits", text: "21 days" }, { text: "no title here" }]);
  const texts = requests.flatMap((r) => r.body.requests.map((x: any) => x.content.parts[0].text));
  expect(texts).toEqual([
    "task: search result | query: can my landlord keep my deposit?",
    "title: Security deposits | text: 21 days",
    "title: none | text: no title here",
  ]);
  expect(requests[0].url).toContain("gemini-embedding-2:batchEmbedContents");
  expect(requests[0].headers["x-goog-api-key"]).toBe("test-key");
  expect(requests[0].body.requests[0].outputDimensionality).toBe(1536);
});

test("batches 100 per request, keeps order, and normalizes", async () => {
  const vectors = await embedDocuments(Array.from({ length: 150 }, (_, i) => ({ text: `p${i}` })));
  expect(requests.map((r) => r.body.requests.length)).toEqual([100, 50]);
  expect(vectors).toHaveLength(150);
  expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 6);
  expect(vectors[1][0]).toBeGreaterThan(vectors[0][0]); // input order preserved
});

test("fails loudly on a missing key or wrong dimensions", async () => {
  delete process.env.GEMINI_API_KEY;
  await expect(embedQuery("x")).rejects.toThrow("GEMINI_API_KEY");
  process.env.GEMINI_API_KEY = "k";
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] })));
  await expect(embedQuery("x")).rejects.toThrow("expected 1536-d");
});
