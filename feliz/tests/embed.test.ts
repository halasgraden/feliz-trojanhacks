import { beforeEach, expect, test, vi } from "vitest";
const mocked = vi.hoisted(() => ({ inputs: [] as string[], loads: 0, options: [] as unknown[], bad: false }));
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async (_task: string, model: string, options: unknown) => {
    mocked.loads++; mocked.options.push(options);
    expect(model).toBe("Xenova/multilingual-e5-base");
    const pipe = async (texts: string[], args: unknown) => {
      expect(args).toEqual({ pooling: "mean", normalize: true });
      mocked.inputs.push(...texts);
      return { tolist: () => texts.map(() => Array.from({ length: mocked.bad ? 4 : 768 }, (_, j) => Number(j === 0))), dispose() {} };
    };
    pipe.tokenizer = (text: string) => ({ input_ids: [text.split(/\s+/)] });
    return pipe;
  },
}));
import { embedDocuments, embedQuery, embedTexts, EMBEDDING_DIMENSIONS } from "@feliz/rag";
beforeEach(() => { mocked.inputs.length = 0; mocked.bad = false; });
test("local E5 uses passage/query prefixes, 768 unit vectors and one CPU model", async () => {
  const query = await embedQuery("  security deposit  ");
  const docs = await embedDocuments(["Return deadline\nReturn the deposit.", "Another passage."]);
  expect(mocked.inputs).toEqual(["query: security deposit", "passage: Return deadline\nReturn the deposit.", "passage: Another passage."]);
  expect(query).toHaveLength(EMBEDDING_DIMENSIONS);
  expect(docs).toHaveLength(2);
  expect(mocked.loads).toBe(1);
  expect(mocked.options).toEqual([{ dtype: "q8", device: "cpu" }]);
});
test("empty batches need no inference; empty strings and overlong queries are rejected", async () => {
  expect(await embedDocuments([])).toEqual([]);
  await expect(embedQuery(" ")).rejects.toThrow("empty");
  await expect(embedQuery("word ".repeat(600))).rejects.toThrow("512 tokens");
});
test("batching reports progress and rejects invalid output, then recovers", async () => {
  const progress: number[] = [];
  expect(await embedTexts(Array.from({ length: 10 }, (_, i) => `p${i}`), "RETRIEVAL_DOCUMENT", { onProgress: (n) => progress.push(n) })).toHaveLength(10);
  expect(progress).toEqual([4, 8, 10]);
  mocked.bad = true;
  await expect(embedQuery("hello")).rejects.toThrow("invalid 768");
  mocked.bad = false;
  await expect(embedQuery("recovered")).resolves.toHaveLength(768);
});
