import { beforeEach, expect, test, vi } from "vitest";
import { embedDocuments, embedQuery, embedTexts, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@feliz/rag";

const seen: { task: string; texts: string[]; key: string | null }[] = [];

beforeEach(() => {
  seen.length = 0;
  process.env.GEMINI_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      requests: { taskType: string; outputDimensionality: number; content: { parts: { text: string }[] } }[];
    };
    const headers = new Headers(init?.headers);
    seen.push({
      task: body.requests[0]?.taskType ?? "",
      texts: body.requests.map((request) => request.content.parts[0]?.text ?? ""),
      key: headers.get("x-goog-api-key"),
    });
    expect(body.requests.every((request) => request.outputDimensionality === 768)).toBe(true);
    const embeddings = body.requests.map(() => ({ values: Array.from({ length: 768 }, (_, index) => (index === 0 ? 3 : 0)) }));
    return new Response(JSON.stringify({ embeddings }), { status: 200 });
  });
});

test("gemini-embedding-001 uses retrieval task types and returns normalized 768-d vectors", async () => {
  const query = await embedQuery("  security deposit  ");
  const docs = await embedDocuments(["Return deadline\nReturn the deposit.", "Another passage."]);
  expect(EMBEDDING_MODEL).toBe("gemini-embedding-001");
  expect(seen.map((call) => call.task)).toEqual(["RETRIEVAL_QUERY", "RETRIEVAL_DOCUMENT"]);
  expect(seen.flatMap((call) => call.texts)).toEqual([
    "security deposit",
    "Return deadline\nReturn the deposit.",
    "Another passage.",
  ]);
  expect(seen.every((call) => call.key === "test-key")).toBe(true);
  expect(query).toHaveLength(EMBEDDING_DIMENSIONS);
  expect(query[0]).toBeCloseTo(1);
  expect(docs).toHaveLength(2);
});

test("empty batches need no request; empty strings and over-long passages are rejected", async () => {
  expect(await embedDocuments([])).toEqual([]);
  await expect(embedQuery(" ")).rejects.toThrow("empty");
  await expect(embedDocuments(["word ".repeat(5000)])).rejects.toThrow("2048-token limit");
  delete process.env.GEMINI_API_KEY;
  await expect(embedQuery("deposit")).rejects.toThrow("GEMINI_API_KEY");
});

test("an over-long question keeps its end and reports the cut", async () => {
  const words = Array.from({ length: 3000 }, (_, index) => `w${index}`);
  const cuts: { tokens: number; keptTokens: number }[] = [];
  await embedQuery(words.join(" "), { onTruncate: (cut) => cuts.push(cut) });
  const sent = seen.at(-1)?.texts[0] ?? "";
  expect(sent.endsWith("w2999")).toBe(true);
  expect(sent).not.toContain("w0 ");
  expect(cuts).toHaveLength(1);
  expect(cuts[0]?.keptTokens).toBe(2048);
});

test("batching reports progress and rejects an invalid vector", async () => {
  const progress: number[] = [];
  await embedTexts(Array.from({ length: 10 }, (_, index) => `p${index}`), "RETRIEVAL_DOCUMENT", {
    onProgress: (done) => progress.push(done),
  });
  expect(progress).toEqual([10]);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] }), { status: 200 }));
  await expect(embedQuery("hello")).rejects.toThrow("invalid 768");
});
