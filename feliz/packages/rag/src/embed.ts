// Gemini embeddings (multilingual, 100+ languages).
// Queries and documents are embedded with different task prefixes; mixing them up hurts retrieval.
// Changing the model or dimensions means re-embedding everything and matching vector(N) in the migration.
export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 1536; // must match vector(1536); pgvector's HNSW index caps at 2000

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
const MAX_BATCH = 100;

export interface DocumentInput {
  title?: string | null;
  text: string;
}

export const queryPrefix = (q: string) => `task: search result | query: ${q}`;
export const documentPrefix = (d: DocumentInput) => `title: ${d.title?.trim() || "none"} | text: ${d.text}`;

export async function embedQuery(question: string): Promise<number[]> {
  const [v] = await embedTexts([queryPrefix(question)]);
  return v;
}

export async function embedDocuments(docs: DocumentInput[]): Promise<number[][]> {
  return embedTexts(docs.map(documentPrefix));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY;
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

// gemini-embedding-2 already normalizes truncated vectors; this keeps it safe if the model changes.
function normalize(v: number[]): number[] {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
