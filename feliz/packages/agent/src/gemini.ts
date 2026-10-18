import type { CaseFacts, LegalChunk, LegalSearchRecord } from "@feliz/db";
import { composeFromChunks, NOT_COVERED } from "./reply.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { TOOL_DECLARATIONS } from "./schemas.js";
import type { LegalSearchResult } from "./tools/search-law.js";

export const GEMINI_MODEL = "gemini-3.8-flash";

export type ToolExecutor = {
  search(query: string): Promise<LegalSearchResult>;
  get(chunkId: string): Promise<{ chunk: LegalChunk | null; error?: string }>;
};

export type AnswerResult = {
  text: string;
  chunks: LegalChunk[];
  searches: LegalSearchRecord[];
  retrieval: "lexical" | "hybrid";
  relevance: LegalSearchResult["relevance"];
  warnings: string[];
  queryTruncated: boolean;
};

export type AnswerInput = {
  userText: string;
  searchText: string;
  facts: CaseFacts;
};

export interface LanguageModel {
  readonly id: string;
  answer(input: AnswerInput, tools: ToolExecutor): Promise<AnswerResult>;
}

type FetchImpl = typeof fetch;

export function buildGenerateRequest(system: string, contents: unknown[]) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

export class GroundedModel implements LanguageModel {
  readonly id = "grounded-composer";

  async answer(input: AnswerInput, tools: ToolExecutor): Promise<AnswerResult> {
    const found = await tools.search(input.searchText);
    return {
      text: found.chunks.length ? composeFromChunks(found.chunks) : NOT_COVERED,
      chunks: found.chunks,
      searches: found.queries,
      retrieval: found.retrieval,
      relevance: found.relevance,
      warnings: found.warnings,
      queryTruncated: found.queryTruncated,
    };
  }
}

export class GeminiModel implements LanguageModel {
  readonly id = GEMINI_MODEL;

  constructor(
    private apiKey: string,
    private fetchImpl: FetchImpl = fetch,
  ) {}

  async answer(input: AnswerInput, tools: ToolExecutor): Promise<AnswerResult> {
    const contents: { role: string; parts: Record<string, unknown>[] }[] = [
      { role: "user", parts: [{ text: userPrompt(input) }] },
    ];
    const chunks: LegalChunk[] = [];
    const searches: LegalSearchRecord[] = [];
    let retrieval: "lexical" | "hybrid" = "lexical";
    let relevance: LegalSearchResult["relevance"] = "unknown";
    const warnings: string[] = [];
    let queryTruncated = false;

    for (let round = 0; round < 4; round += 1) {
      const parts = await this.generate(contents);
      const calls = parts.filter((part) => part.functionCall);
      if (calls.length === 0) {
        if (searches.length === 0) {
          const found = await tools.search(input.searchText);
          remember(found, chunks, searches);
          retrieval = found.retrieval;
          relevance = found.relevance;
          warnings.push(...found.warnings);
          queryTruncated = found.queryTruncated;
          contents.push({ role: "model", parts });
          contents.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "search_documents",
                  id: "call_forced_search",
                  response: { result: found.publicResult },
                },
              },
            ],
          });
          continue;
        }
        const text = visibleText(parts);
        return {
          text: text || (chunks.length ? composeFromChunks(chunks) : NOT_COVERED),
          chunks,
          searches,
          retrieval,
          relevance,
          warnings,
          queryTruncated,
        };
      }

      contents.push({ role: "model", parts });
      const responses: Record<string, unknown>[] = [];
      for (const part of calls) {
        const call = part.functionCall as { name?: string; id?: string; args?: Record<string, unknown> };
        const name = call.name ?? "search_documents";
        const id = call.id ?? `call_${round}_${responses.length}`;
        const result = await runCall(name, call.args ?? {}, input.searchText, tools, chunks, searches);
        if (result.retrieval) retrieval = result.retrieval;
        if (result.relevance) relevance = result.relevance;
        if (result.warnings) warnings.push(...result.warnings);
        if (result.queryTruncated) queryTruncated = true;
        responses.push({
          functionResponse: { name, id, response: { result: result.payload } },
        });
      }
      contents.push({ role: "user", parts: responses });
    }

    return {
      text: chunks.length ? composeFromChunks(chunks) : NOT_COVERED,
      chunks,
      searches,
      retrieval,
      relevance,
      warnings,
      queryTruncated,
    };
  }

  private async generate(contents: { role: string; parts: Record<string, unknown>[] }[]) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(buildGenerateRequest(SYSTEM_PROMPT, contents)),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: Record<string, unknown>[] } }[];
    };
    if (!response.ok) throw new Error(body.error?.message || `Gemini request failed (${response.status}).`);
    const parts = body.candidates?.[0]?.content?.parts;
    if (!parts?.length) throw new Error("Gemini returned no content.");
    return parts;
  }
}

function userPrompt(input: AnswerInput): string {
  return [`Confirmed facts: ${JSON.stringify(input.facts)}`, "", "Renter:", input.userText].join("\n");
}

function visibleText(parts: Record<string, unknown>[]): string {
  return parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("")
    .trim();
}

function remember(found: LegalSearchResult, chunks: LegalChunk[], searches: LegalSearchRecord[]) {
  searches.push(...found.queries);
  for (const chunk of found.chunks) {
    if (!chunks.some((item) => item.id === chunk.id)) chunks.push(chunk);
  }
}

async function runCall(
  name: string,
  args: Record<string, unknown>,
  searchText: string,
  tools: ToolExecutor,
  chunks: LegalChunk[],
  searches: LegalSearchRecord[],
): Promise<{
  payload: unknown;
  retrieval?: "lexical" | "hybrid";
  relevance?: LegalSearchResult["relevance"];
  warnings?: string[];
  queryTruncated?: boolean;
}> {
  if (name === "get_document") {
    const found = await tools.get(String(args.chunkId ?? ""));
    if (found.chunk && !chunks.some((item) => item.id === found.chunk?.id)) chunks.push(found.chunk);
    return {
      payload: found.chunk
        ? {
            id: found.chunk.id,
            publisher: found.chunk.publisher,
            title: found.chunk.title,
            url: found.chunk.url,
            fetchedAt: found.chunk.fetchedAt,
            heading: found.chunk.heading,
            body: found.chunk.body,
          }
        : { error: found.error ?? "That id is not in the legal documents." },
    };
  }
  const found = await tools.search(String(args.query ?? searchText));
  remember(found, chunks, searches);
  return {
    payload: found.publicResult,
    retrieval: found.retrieval,
    relevance: found.relevance,
    warnings: found.warnings,
    queryTruncated: found.queryTruncated,
  };
}
