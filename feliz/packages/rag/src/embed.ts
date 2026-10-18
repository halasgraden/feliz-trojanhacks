import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/** Never compare these vectors with Gemini vectors, even at the same width. */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-base";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_MAX_TOKENS = 512;
export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
export interface EmbedOptions { onProgress?: (done: number, total: number) => void }
let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;
let work: Promise<unknown> = Promise.resolve();

async function extractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Parsing/dry-run and agent imports do not load ONNX or download weights.
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = process.env.FELIZ_MODEL_CACHE || join(tmpdir(), "feliz-models");
      env.localModelPath = env.cacheDir;
      env.allowRemoteModels = process.env.FELIZ_MODEL_OFFLINE !== "1";
      return pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8", device: "cpu" });
    })().catch((error) => { extractorPromise = undefined; throw error; });
  }
  return extractorPromise;
}

export const chunkEmbeddingText = (chunk: { heading: string; body: string }) => `${chunk.heading}\n${chunk.body}`;
export const embeddingInput = (text: string, task: EmbeddingTask) => `${task === "RETRIEVAL_QUERY" ? "query" : "passage"}: ${text.trim()}`;
export function embedDocuments(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> { return embedTexts(texts, "RETRIEVAL_DOCUMENT", opts); }
export async function embedQuery(query: string, opts: EmbedOptions = {}): Promise<number[]> { const [vector] = await embedTexts([query], "RETRIEVAL_QUERY", opts); return vector; }

/** Local serialized inference. First run downloads public weights; later runs reuse them. */
export function embedTexts(texts: string[], task: EmbeddingTask, opts: EmbedOptions = {}): Promise<number[][]> {
  if (!texts.length) return Promise.resolve([]);
  if (texts.some((text) => !text.trim())) return Promise.reject(new Error("Cannot embed empty text"));
  const inputs = texts.map((text) => embeddingInput(text, task));
  const run = work.then(async () => {
    const pipe = await extractor();
    for (const [index, text] of inputs.entries()) {
      const tokens = pipe.tokenizer(text, { truncation: false, return_tensor: false });
      const ids = tokens.input_ids as number[][];
      if (ids[0].length > EMBEDDING_MAX_TOKENS) throw new Error(`Embedding input ${index} exceeds ${EMBEDDING_MAX_TOKENS} tokens; split the passage or shorten the query`);
    }
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i += 4) {
      const tensor = await pipe(inputs.slice(i, i + 4), { pooling: "mean", normalize: true });
      const batch = tensor.tolist() as number[][];
      tensor.dispose();
      if (batch.length !== Math.min(4, inputs.length - i)) throw new Error("Local embedding batch count mismatch");
      for (const vector of batch) {
        const norm = Math.hypot(...vector);
        if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite) || norm < 0.99 || norm > 1.01) throw new Error("Local model returned an invalid 768-dimensional unit vector");
        vectors.push(vector);
      }
      opts.onProgress?.(vectors.length, inputs.length);
    }
    return vectors;
  });
  work = run.catch(() => undefined);
  return run;
}
