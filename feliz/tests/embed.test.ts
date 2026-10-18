import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { embedDocuments, embedQuery, embedTexts, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@feliz/rag";

const seen: { task: string; text: string }[] = [];
const TOKEN_URL = "https://oauth2.example/token";

beforeEach(() => {
  seen.length = 0;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const file = join(mkdtempSync(join(tmpdir(), "sa-")), "key.json");
  writeFileSync(file, JSON.stringify({
    type: "service_account",
    project_id: "demo-project",
    client_email: "bot@demo-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: TOKEN_URL,
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    const body = JSON.parse(String(init?.body)) as {
      instances: { task_type: string; content: string }[];
      parameters: { outputDimensionality: number };
    };
    seen.push({ task: body.instances[0]?.task_type ?? "", text: body.instances[0]?.content ?? "" });
    expect(body.parameters.outputDimensionality).toBe(768);
    const values = Array.from({ length: 768 }, (_, index) => (index === 0 ? 3 : 0));
    return new Response(JSON.stringify({ predictions: [{ embeddings: { values } }] }));
  });
});

test("gemini-embedding-001 uses retrieval task types and returns normalized 768-d vectors", async () => {
  const query = await embedQuery("  security deposit  ");
  const docs = await embedDocuments(["Return deadline\nReturn the deposit.", "Another passage."]);
  expect(EMBEDDING_MODEL).toBe("gemini-embedding-001");
  expect(seen.map((call) => call.task)).toEqual(["RETRIEVAL_QUERY", "RETRIEVAL_DOCUMENT", "RETRIEVAL_DOCUMENT"]);
  expect(seen.map((call) => call.text)).toEqual([
    "security deposit",
    "Return deadline\nReturn the deposit.",
    "Another passage.",
  ]);
  expect(query).toHaveLength(EMBEDDING_DIMENSIONS);
  expect(query[0]).toBeCloseTo(1);
  expect(docs).toHaveLength(2);
});

test("empty batches need no request; empty strings and over-long passages are rejected", async () => {
  expect(await embedDocuments([])).toEqual([]);
  await expect(embedQuery(" ")).rejects.toThrow("empty");
  await expect(embedDocuments(["word ".repeat(5000)])).rejects.toThrow("2048-token limit");
  // embed.ts falls back to reading feliz/.env; stop that so a developer's real .env can't satisfy it.
  const loadEnv = vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  await expect(embedQuery("deposit")).rejects.toThrow("GOOGLE_APPLICATION_CREDENTIALS");
  loadEnv.mockRestore();
});

test("an over-long question keeps its end and reports the cut", async () => {
  const words = Array.from({ length: 3000 }, (_, index) => `w${index}`);
  const cuts: { tokens: number; keptTokens: number }[] = [];
  await embedQuery(words.join(" "), { onTruncate: (cut) => cuts.push(cut) });
  const sent = seen.at(-1)?.text ?? "";
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
  expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    return new Response(JSON.stringify({ predictions: [{ embeddings: { values: [1, 2, 3] } }] }), { status: 200 });
  });
  await expect(embedQuery("hello")).rejects.toThrow("invalid 768");
});

test("service account route: signs in once, calls Vertex per text, keeps order, retries rate limits", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const file = join(mkdtempSync(join(tmpdir(), "sa-")), "key.json");
  writeFileSync(file, JSON.stringify({
    type: "service_account", project_id: "demo-project", client_email: "bot@demo-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.example/token",
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  process.env.FELIZ_EMBED_RETRY_MS = "1";
  const calls: { url: string; auth?: string; body: any }[] = [];
  let rateLimited = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url === "https://oauth2.example/token") {
      const assertion = new URLSearchParams(init.body as string).get("assertion")!;
      const [h, p, sig] = assertion.split(".");
      expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url")).toBe(true);
      expect(JSON.parse(Buffer.from(p, "base64url").toString()).iss).toBe("bot@demo-project.iam.gserviceaccount.com");
      calls.push({ url, body: null });
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    const body = JSON.parse(init.body as string);
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization, body });
    if (!rateLimited) { rateLimited = true; return new Response("{}", { status: 429 }); }
    const n = Number(body.instances[0].content.slice(1));
    const values = Array.from({ length: 768 }, (_, j) => (j === n ? 2 : 0));
    return new Response(JSON.stringify({ predictions: [{ embeddings: { values } }] }));
  });
  try {
    const vectors = await embedDocuments(["p0", "p1", "p2"]);
    const predicts = calls.filter((c) => c.url.includes("aiplatform"));
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1); // token reused
    expect(predicts[0].url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-embedding-001:predict");
    expect(predicts.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(predicts[0].body).toEqual({ instances: [{ content: "p0", task_type: "RETRIEVAL_DOCUMENT" }], parameters: { outputDimensionality: 768 } });
    expect(predicts).toHaveLength(4); // 3 texts + 1 retried after 429
    expect(vectors.map((v) => v.indexOf(1))).toEqual([0, 1, 2]); // normalized, in input order
  } finally {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FELIZ_EMBED_RETRY_MS;
    vi.unstubAllGlobals();
  }
});
