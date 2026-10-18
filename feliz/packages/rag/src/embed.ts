import { fileURLToPath } from "node:url";

/** Stored on each chunk. Vectors from any other model, including local E5, are not scored. */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
/** gemini-embedding-001 accepts 2,048 tokens. Output is truncated to 768 and then normalized. */
export const EMBEDDING_MAX_TOKENS = 2048;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = EMBEDDING_MAX_TOKENS * CHARS_PER_TOKEN;
const BATCH = 100;

export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
export interface EmbedOptions {
  onProgress?: (done: number, total: number) => void;
  /** Called when a query was longer than the model accepts and only its end was kept. */
  onTruncate?: (info: { index: number; tokens: number; keptTokens: number }) => void;
}

let work: Promise<unknown> = Promise.resolve();

export const chunkEmbeddingText = (chunk: { heading: string; body: string }) => `${chunk.heading}\n${chunk.body}`;

/** Gemini selects the retrieval task with taskType, not an E5 text prefix. */
export const embeddingInput = (text: string, _task: EmbeddingTask) => text.trim();

export function embedDocuments(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  return embedTexts(texts, "RETRIEVAL_DOCUMENT", opts);
}

export async function embedQuery(query: string, opts: EmbedOptions = {}): Promise<number[]> {
  const [vector] = await embedTexts([query], "RETRIEVAL_QUERY", opts);
  return vector;
}

/** Serialized Gemini batch calls. A missing key fails this call; retrieve() then uses keywords. */
export function embedTexts(texts: string[], task: EmbeddingTask, opts: EmbedOptions = {}): Promise<number[][]> {
  if (!texts.length) return Promise.resolve([]);
  if (texts.some((text) => !text.trim())) return Promise.reject(new Error("Cannot embed empty text"));
  const inputs = texts.map((text) => text.trim());
  for (const [index, text] of inputs.entries()) {
    if (text.length <= MAX_CHARS) continue;
    const tokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    if (task !== "RETRIEVAL_QUERY") {
      return Promise.reject(new Error(`Embedding input ${index} has about ${tokens} tokens, over the ${EMBEDDING_MAX_TOKENS}-token limit; split the passage`));
    }
    inputs[index] = text.slice(-MAX_CHARS);
    opts.onTruncate?.({ index, tokens, keptTokens: EMBEDDING_MAX_TOKENS });
  }
  const run = work.then(() => embedBatch(inputs, task, opts));
  work = run.catch(() => undefined);
  return run;
}

async function embedBatch(texts: string[], task: EmbeddingTask, opts: EmbedOptions): Promise<number[][]> {
  const apiKey = geminiKey();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: task,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      embeddings?: { values?: number[] }[];
    };
    if (!response.ok) throw new Error(body.error?.message || `Gemini embedding failed (${response.status}).`);
    const rows = body.embeddings ?? [];
    if (rows.length !== batch.length) throw new Error("Gemini embedding batch count mismatch");
    for (const row of rows) vectors.push(unitVector(row.values));
    opts.onProgress?.(vectors.length, texts.length);
  }
  return vectors;
}

function geminiKey(): string {
  if (!process.env.GEMINI_API_KEY) {
    try {
      process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
    } catch {
      /* the key may already be in the environment */
    }
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY must be set to embed with gemini-embedding-001");
  return key;
}

/** gemini-embedding-001 is 3,072-wide. A 768-wide slice must be normalized before cosine similarity. */
function unitVector(values: number[] | undefined): number[] {
  if (!values || values.length !== EMBEDDING_DIMENSIONS || !values.every(Number.isFinite)) {
    throw new Error("Gemini returned an invalid 768-dimensional vector");
  }
  const norm = Math.hypot(...values);
  if (norm === 0) throw new Error("Gemini returned an invalid 768-dimensional vector");
  return values.map((value) => value / norm);
}
