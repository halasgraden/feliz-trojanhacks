// Gemini embeddings for the legal corpus, per docs/rag-supabase.md.
// Changing the model or dimensions means re-embedding every chunk and matching vector(768).
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
const MAX_BATCH = 100;

export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbedOptions {
  /** Defaults to GEMINI_API_KEY. */
  apiKey?: string;
}

/** The exact string a chunk is embedded from. */
export const chunkEmbeddingText = (chunk: { heading: string; body: string }) => `${chunk.heading}\n${chunk.body}`;

export function embedDocuments(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  return embedTexts(texts, "RETRIEVAL_DOCUMENT", opts);
}

export async function embedQuery(query: string, opts: EmbedOptions = {}): Promise<number[]> {
  const [v] = await embedTexts([query], "RETRIEVAL_QUERY", opts);
  return v;
}

export async function embedTexts(texts: string[], taskType: EmbeddingTask, opts: EmbedOptions = {}): Promise<number[][]> {
  const key = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: texts.slice(i, i + MAX_BATCH).map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Gemini embeddings ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { embeddings: { values: number[] }[] };
    for (const e of json.embeddings) {
      if (e.values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`expected ${EMBEDDING_DIMENSIONS}-d embedding, got ${e.values.length}`);
      }
      out.push(normalize(e.values));
    }
  }
  return out;
}

// gemini-embedding-001 only returns unit vectors at its full 3072 dimensions;
// truncated outputs must be normalized for cosine scores to mean anything.
function normalize(v: number[]): number[] {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
