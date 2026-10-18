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
    // Same shape as the real tokenizer for one string: a FLAT id array (an earlier mock returned
    // [[...]], which hid a bug where the 512-token check never ran). One "id" per word here.
    const tok = (text: string, o: { add_special_tokens?: boolean } = {}) => {
      const words = text.split(/\s+/).filter(Boolean);
      return { input_ids: o.add_special_tokens === false ? words : ["<s>", ...words, "</s>"] };
    };
    tok.decode = (ids: string[]) => ids.join(" ");
    pipe.tokenizer = tok;
    return pipe;
  },
}));
import { embedDocuments, embedQuery, embedTexts, tokenIds, EMBEDDING_DIMENSIONS } from "@feliz/rag";
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
test("empty batches need no inference; empty strings and over-long passages are rejected", async () => {
  expect(await embedDocuments([])).toEqual([]);
  await expect(embedQuery(" ")).rejects.toThrow("empty");
  await expect(embedDocuments(["word ".repeat(600)])).rejects.toThrow("512-token limit");
});
test("an over-long question keeps its END (the newest message) and reports the cut", async () => {
  const words = Array.from({ length: 700 }, (_, i) => `w${i}`);
  const cuts: { tokens: number; keptTokens: number }[] = [];
  await embedQuery(words.join(" "), { onTruncate: (c) => cuts.push(c) });
  const sent = mocked.inputs.at(-1)!;
  expect(sent.startsWith("query: ")).toBe(true);
  expect(sent.endsWith("w699")).toBe(true); // last word kept
  expect(sent).not.toContain(" w0 ");       // start dropped
  expect(cuts).toEqual([{ index: 0, tokens: 703, keptTokens: 512 }]); // "query:" + 700 words + 2 specials
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

test("token counting handles both flat and nested tokenizer output", () => {
  const flat = { tokenizer: Object.assign(() => ({ input_ids: [1, 2, 3] }), { decode: () => "" }) } as any;
  const nested = { tokenizer: Object.assign(() => ({ input_ids: [[1, 2, 3, 4]] }), { decode: () => "" }) } as any;
  expect(tokenIds(flat, "x")).toHaveLength(3);
  expect(tokenIds(nested, "x")).toHaveLength(4);
});
