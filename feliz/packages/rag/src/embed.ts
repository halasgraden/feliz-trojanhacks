import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Stored on each chunk. Vectors from any other model, including local E5, are not scored. */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
/** gemini-embedding-001 accepts 2,048 tokens. Output is truncated to 768 and then normalized. */
export const EMBEDDING_MAX_TOKENS = 2048;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = EMBEDDING_MAX_TOKENS * CHARS_PER_TOKEN;

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

/**
 * Serialized Vertex embedding calls. GOOGLE_APPLICATION_CREDENTIALS must point at a
 * service-account JSON key (one text per request; the project needs billing).
 * Missing credentials fail this call; retrieve() then uses keywords.
 */
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

/** Which route embedTexts will use, for logs and traces. */
export function embeddingRoute(): "vertex" | "none" {
  loadEnv();
  return process.env.GOOGLE_APPLICATION_CREDENTIALS ? "vertex" : "none";
}

async function embedBatch(texts: string[], task: EmbeddingTask, opts: EmbedOptions): Promise<number[][]> {
  if (embeddingRoute() === "none") {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a service account key file to embed with gemini-embedding-001");
  }
  return embedVertex(texts, task, opts);
}

const VERTEX_CONCURRENCY = 4;

/** Vertex accepts one text per request for gemini-embedding-001; a few run at once, kept in input order. */
async function embedVertex(texts: string[], task: EmbeddingTask, opts: EmbedOptions): Promise<number[][]> {
  const account = serviceAccount();
  const location = process.env.VERTEX_LOCATION || "us-central1";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${account.project_id}/locations/${location}/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  const vectors: number[][] = new Array(texts.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      const body = await postJson<{ predictions?: { embeddings?: { values?: number[] } }[] }>(
        url,
        { authorization: `Bearer ${await accessToken(account)}` },
        { instances: [{ content: texts[i], task_type: task }], parameters: { outputDimensionality: EMBEDDING_DIMENSIONS } },
      );
      vectors[i] = unitVector(body.predictions?.[0]?.embeddings?.values);
      opts.onProgress?.(++done, texts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERTEX_CONCURRENCY, texts.length) }, worker));
  return vectors;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

let account: { path: string; value: ServiceAccount } | undefined;
let token: { value: Promise<string>; expires: number } | undefined;

/** Access token and project for Vertex calls. Chat uses this; embeddings use the same sign-in. */
export async function vertexAccessToken(): Promise<{ token: string; projectId: string }> {
  loadEnv();
  const account = serviceAccount();
  return { token: await accessToken(account), projectId: account.project_id };
}

function serviceAccount(): ServiceAccount {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
  if (account?.path !== path) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ServiceAccount> & { type?: string };
    if (parsed.type !== "service_account" || !parsed.client_email || !parsed.private_key || !parsed.project_id) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS must point at a service account JSON key (${path})`);
    }
    account = { path, value: { token_uri: "https://oauth2.googleapis.com/token", ...parsed } as ServiceAccount };
    token = undefined;
  }
  return account.value;
}

/**
 * OAuth access token for the service account (signed JWT exchange), reused until shortly before
 * expiry. Concurrent callers share one in-flight sign-in.
 */
function accessToken(sa: ServiceAccount): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const value = signIn(sa);
  token = { value, expires: Date.now() + 50 * 60_000 };
  value.catch(() => { if (token?.value === value) token = undefined; });
  return value;
}

async function signIn(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Service account sign-in failed: ${json.error_description ?? res.status}`);
  return json.access_token;
}

const MAX_RETRIES = 5;

/** POST JSON, retrying rate limits and brief outages with backoff; other errors fail at once. */
async function postJson<T>(url: string, headers: Record<string, string>, payload: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (res.ok) return body;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(body.error?.message || `Embedding request failed (${res.status}).`);
    }
    const wait = Number(process.env.FELIZ_EMBED_RETRY_MS ?? 2000) * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
}

function loadEnv() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    /* credentials may already be in the environment */
  }
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
