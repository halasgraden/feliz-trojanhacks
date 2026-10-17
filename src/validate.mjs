import { sourceById } from "./knowledge.mjs";

const BANNED = [
  /you will win/i,
  /guaranteed/i,
  /broke the law/i,
  /definitely entitled/i,
  /illegal for sure/i,
  /your landlord (?:is|was) illegal/i,
];

export function validateAnswer(answer, sources) {
  const problems = [];
  const allowedIds = new Set((sources ?? []).map((source) => source.id));

  for (const claim of answer.claims ?? []) {
    if (!claim.sourceIds?.length) {
      problems.push("A legal claim has no source.");
      continue;
    }
    for (const id of claim.sourceIds) {
      if (!allowedIds.has(id) || !sourceById(id)) problems.push(`Unknown source ${id}.`);
    }
    checkNumbers(claim.text, claim.sourceIds, answer.factNumbers ?? [], problems);
  }

  for (const step of answer.nextSteps ?? []) {
    if (step.kind === "referral" || step.kind === "question") continue;
    if (!step.sourceIds?.length) problems.push("An action step has no source.");
    checkNumbers(step.text, step.sourceIds ?? [], answer.factNumbers ?? [], problems);
  }

  const reply = answer.reply ?? "";
  for (const pattern of BANNED) {
    if (pattern.test(reply)) problems.push(`Reply contains unsupported certainty: ${pattern}`);
  }

  return { ok: problems.length === 0, problems };
}

function checkNumbers(text, sourceIds, factNumbers, problems) {
  const allowed = new Set(factNumbers);
  for (const id of sourceIds) {
    const source = sourceById(id);
    if (!source) continue;
    for (const value of significantNumbers(`${source.text} ${JSON.stringify(source.rules)}`)) {
      allowed.add(value);
    }
  }
  for (const value of significantNumbers(text)) {
    if (!allowed.has(value)) problems.push(`Number ${value} is not in the cited sources or the user facts.`);
  }
}

export function significantNumbers(text) {
  const values = new Set();
  for (const match of String(text).matchAll(/\$(\d{1,3}(?:,\d{3})*|\d+)/g)) {
    values.add(Number(match[1].replace(/,/g, "")));
  }
  for (const match of String(text).matchAll(/\b(\d+)\s+days?\b/gi)) values.add(Number(match[1]));
  for (const match of String(text).matchAll(/\b(\d{2,})\b/g)) values.add(Number(match[0]));
  return [...values];
}

export function factNumbers(facts = {}) {
  return Object.values(facts).filter((value) => typeof value === "number");
}
