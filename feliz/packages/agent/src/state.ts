import type { CaseFacts } from "@feliz/db";

export function nextFacts(before: CaseFacts, extracted: CaseFacts): CaseFacts {
  return { ...before, ...extracted };
}
