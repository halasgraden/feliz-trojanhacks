import { compactCase, createCase, mergeExtraction, userTranscript, writeSummary } from "./case.mjs";
import { classifyTranscript } from "./classify.mjs";
import { extractCaseFacts } from "./extract.mjs";
import { explainCase } from "./explain.mjs";
import { geminiExtract, geminiRewrite } from "./gemini.mjs";
import { DISCLAIMER } from "./knowledge.mjs";
import { parseLocation, resolveJurisdiction } from "./jurisdiction.mjs";
import { findHousingResources, searchLegalSources } from "./retrieve.mjs";
import { checkUrgency } from "./urgency.mjs";
import { factNumbers, significantNumbers, validateAnswer } from "./validate.mjs";

const FACT_FIELDS = new Set([
  "city",
  "moveOutDate",
  "itemizedStatement",
  "amountWithheld",
  "depositAmount",
]);

export async function handleTurn(existing, message, options = {}) {
  if (!message || !String(message).trim()) {
    return publicView({
      record: existing,
      engine: "deterministic",
      engineNote: "Say what happened with the landlord.",
      validation: { ok: true, problems: [] },
      reply: "Tell me what happened with the rental. A security deposit, an eviction notice, or a rent increase are the three situations this navigator can sort.",
      saved: false,
    });
  }

  const now = options.now ?? new Date().toISOString();
  const today = options.today ?? now.slice(0, 10);
  const record = existing ?? createCase(now);
  record.turns.push({ role: "user", text: String(message), at: now });

  const engine = await interpret(record, String(message), { ...options, today });
  const view = finish(record, { ...options, today, now, ...engine });
  if (engine.engine !== "gemini") return view;
  return maybeRewrite(view, options);
}

export async function updateCaseFacts(existing, field, value, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const today = options.today ?? now.slice(0, 10);
  const record = existing ?? createCase(now);
  const applied = applyFact(record, field, value);
  if (applied.error) {
    return publicView({
      record,
      engine: "deterministic",
      engineNote: applied.error,
      validation: { ok: false, problems: [applied.error] },
      reply: applied.error,
      saved: false,
    });
  }
  record.turns.push({ role: "user", text: `Correction: ${field} is ${value}.`, at: now });
  return finish(record, { ...options, today, now, engine: "deterministic", engineNote: "Fact corrected by you." });
}

export function classifyHousingIssue(message) {
  return classifyTranscript(message, "unknown");
}

export function previewExtraction(message, today = new Date().toISOString().slice(0, 10)) {
  return extractCaseFacts(message, { today, followUps: [] });
}

async function interpret(record, message, options) {
  const transcript = userTranscript(record);
  const classified = classifyTranscript(transcript, record.category);
  record.category = classified.category;

  mergeExtraction(record, extractCaseFacts(message, { today: options.today, followUps: record.followUps }));

  if (!options.apiKey || options.allowGemini === false) {
    return { engine: "deterministic", engineNote: options.apiKey ? "Gemini skipped for this run." : "No Gemini API key. Using the deterministic navigator." };
  }

  try {
    const extracted = await geminiExtract({
      apiKey: options.apiKey,
      model: options.model || "gemini-2.5-flash",
      message,
    });
    const located = extracted.confirmed.city ? parseLocation(extracted.confirmed.city) : null;
    delete extracted.confirmed.city;
    if (located?.city && located.confidence === "confirmed") {
      extracted.confirmed.city = located.city;
      if (located.state) extracted.confirmed.state = located.state;
      if (located.county) extracted.confirmed.county = located.county;
      if (located.outsideCalifornia) extracted.confirmed.outsideCalifornia = true;
    }
    const additions = {};
    for (const [key, value] of Object.entries(extracted.confirmed)) {
      if (record.facts[key] === undefined) additions[key] = value;
    }
    mergeExtraction(record, { confirmed: additions });
    return {
      engine: "gemini",
      engineNote: "Gemini extracted facts. Legal statements still come from the curated sources.",
      model: options.model || "gemini-2.5-flash",
    };
  } catch (error) {
    return {
      engine: "deterministic",
      engineNote: `Gemini was unavailable (${error.message}). Used the deterministic navigator.`,
    };
  }
}

function finish(record, options) {
  const today = options.today;
  record.jurisdiction = resolveJurisdiction(record.facts, record.unconfirmed);
  record.urgency = checkUrgency(userTranscript(record), record.facts);
  record.sources = searchLegalSources(record);
  record.resources = findHousingResources(record);

  const explained = explainCase(record, record.sources, today);
  record.claims = explained.claims;
  record.calculations = explained.calculations;
  record.nextSteps = explained.nextSteps;
  record.followUps = explained.followUps;
  record.missing = explained.missing;

  let reply = explained.reply;
  let validation = validateAnswer(
    { ...explained, reply, factNumbers: factNumbers(record.facts) },
    record.sources,
  );
  if (!validation.ok) {
    record.claims = [];
    record.calculations = [];
    record.nextSteps = [];
    reply = [
      DISCLAIMER,
      "",
      "I could not verify a draft explanation against the retrieved sources, so I am not stating a legal conclusion.",
      "Use the organizations listed for this jurisdiction, or ask a legal-aid lawyer to review the facts.",
    ].join("\n");
    validation = { ok: false, problems: validation.problems };
  }

  record.summary = writeSummary(record);
  record.updatedAt = options.now ?? new Date().toISOString();
  record.turns.push({ role: "assistant", text: reply, at: record.updatedAt });

  return publicView({
    record,
    engine: options.engine,
    engineNote: options.engineNote,
    model: options.model,
    validation,
    reply,
    pendingRewrite: validation.ok ? options : null,
  });
}

export async function maybeRewrite(view, options) {
  if (!view || view.engine !== "gemini" || !options.apiKey || !view.validation?.ok) return view;
  try {
    const rewritten = await geminiRewrite({
      apiKey: options.apiKey,
      model: options.model || "gemini-2.5-flash",
      reply: view.reply,
    });
    if (!rewriteIsSafe(view.reply, rewritten)) {
      view.engineNote += " The grounded reply was kept because the rewrite added or dropped sourced material.";
      return view;
    }
    view.reply = rewritten;
    const last = view.caseRecord.turns[view.caseRecord.turns.length - 1];
    if (last?.role === "assistant") last.text = rewritten;
    view.case = compactCase(view.caseRecord);
    view.engineNote += " The wording was rewritten by Gemini and checked against the sourced draft.";
    return view;
  } catch (error) {
    view.engineNote += ` Reply rewrite skipped (${error.message}).`;
    return view;
  }
}

function rewriteIsSafe(original, rewritten) {
  if (!rewritten || rewritten.length < 40) return false;
  const allowed = new Set(significantNumbers(original));
  for (const value of significantNumbers(rewritten)) {
    if (!allowed.has(value)) return false;
  }
  const ids = original.match(/ca-courts-[a-z0-9-]+/g) ?? [];
  return ids.every((id) => rewritten.includes(id));
}

function applyFact(record, field, value) {
  if (!FACT_FIELDS.has(field)) {
    return { error: `Unknown fact "${field}". Use city, moveOutDate, itemizedStatement, amountWithheld, or depositAmount.` };
  }
  if (field === "city") {
    const location = parseLocation(String(value));
    if (!location.city) return { error: `I don't recognize the city "${value}" in this MVP directory.` };
    record.facts.city = location.city;
    if (location.state) record.facts.state = location.state;
    if (location.county) record.facts.county = location.county;
    record.facts.outsideCalifornia = location.outsideCalifornia;
    delete record.unconfirmed.city;
    delete record.unconfirmed.state;
    return {};
  }
  if (field === "moveOutDate") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return { error: "moveOutDate must be YYYY-MM-DD." };
    record.facts.moveOutDate = String(value);
    return {};
  }
  if (field === "itemizedStatement") {
    const normalized = String(value).toLowerCase();
    if (normalized !== "yes" && normalized !== "no") return { error: "itemizedStatement must be yes or no." };
    record.facts.itemizedStatement = normalized;
    return {};
  }
  const amount = Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return { error: `${field} must be a dollar amount.` };
  record.facts[field] = amount;
  return {};
}

function publicView({ record, engine, engineNote, validation, reply, model, saved = true }) {
  return {
    engine,
    model: model ?? null,
    engineNote,
    disclaimer: DISCLAIMER,
    reply,
    validation,
    saved,
    followUps: record?.followUps ?? [],
    citations: (record?.sources ?? []).map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      lastVerified: source.lastVerified,
    })),
    resources: (record?.resources ?? []).map((resource) => ({
      id: resource.id,
      name: resource.name,
      url: resource.url,
      eligibility: resource.eligibility,
    })),
    case: compactCase(record),
    caseRecord: record,
  };
}
