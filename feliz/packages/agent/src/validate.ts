import type { CaseFacts, LegalChunk } from "@feliz/db";
import { citationsInReply } from "@feliz/rag";

const BANNED = [/you will win/i, /guaranteed/i, /broke the law/i, /definitely entitled/i];

export function validateReply(reply: string, chunks: LegalChunk[], facts: CaseFacts): string[] {
  const problems: string[] = [];
  for (const pattern of BANNED) {
    if (pattern.test(reply)) problems.push(`Reply contains unsupported certainty: ${pattern}`);
  }

  let cited: LegalChunk[] = [];
  try {
    cited = citationsInReply(reply, chunks);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "A source line does not match a document retrieved on this turn.");
  }

  const allowed = new Set<number>();
  for (const value of Object.values(facts)) {
    if (typeof value === "number") allowed.add(value);
  }
  for (const chunk of cited) {
    for (const value of numbersIn(chunk.body)) allowed.add(value);
  }
  for (const value of numbersIn(reply)) {
    if (!allowed.has(value)) problems.push(`Number ${value} is not in a cited document or a confirmed fact.`);
  }
  return problems;
}

export function numbersIn(text: string): number[] {
  const values = new Set<number>();
  for (const match of text.matchAll(/\$(\d{1,3}(?:,\d{3})*|\d+)/g)) values.add(Number(match[1].replace(/,/g, "")));
  for (const match of text.matchAll(/\b(\d+)\s+days?\b/gi)) values.add(Number(match[1]));
  return [...values];
}
