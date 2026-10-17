export function createCase(now = new Date().toISOString()) {
  return {
    id: `case_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    category: "unknown",
    jurisdiction: emptyJurisdiction(),
    urgency: { level: "routine", reasons: [] },
    facts: {},
    unconfirmed: {},
    missing: [],
    followUps: [],
    sources: [],
    resources: [],
    claims: [],
    calculations: [],
    nextSteps: [],
    summary: "",
    turns: [],
  };
}

export function emptyJurisdiction() {
  return {
    state: null,
    county: null,
    city: null,
    confidence: "missing",
    assumption: null,
    scopeNote: null,
  };
}

export function mergeExtraction(record, extraction) {
  for (const [key, value] of Object.entries(extraction.confirmed ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    record.facts[key] = value;
    delete record.unconfirmed[key];
  }
  for (const [key, value] of Object.entries(extraction.unconfirmed ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (record.facts[key] !== undefined) continue;
    record.unconfirmed[key] = value;
  }
}

export function compactCase(record) {
  if (!record) return null;
  return {
    id: record.id,
    updatedAt: record.updatedAt,
    category: record.category,
    jurisdiction: record.jurisdiction,
    urgency: record.urgency,
    facts: record.facts,
    unconfirmed: record.unconfirmed,
    missing: record.missing,
    followUps: record.followUps,
    claims: record.claims ?? [],
    calculations: record.calculations ?? [],
    citations: (record.sources ?? []).map(cite),
    resources: (record.resources ?? []).map(resourceCard),
    nextSteps: record.nextSteps,
    summary: record.summary,
    turns: record.turns,
  };
}

export function cite(source) {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    publisher: source.publisher,
    lastVerified: source.lastVerified,
  };
}

export function resourceCard(resource) {
  return {
    id: resource.id,
    name: resource.name,
    url: resource.url,
    eligibility: resource.eligibility,
    notes: resource.notes,
  };
}

export function userTranscript(record) {
  return (record?.turns ?? [])
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join("\n");
}

export function writeSummary(record) {
  const factLines = Object.entries(record.facts).map(([key, value]) => `${key}: ${value}`);
  const openLines = Object.entries(record.unconfirmed).map(([key, value]) => `${key}: ${value} (unconfirmed)`);
  const where = [
    record.jurisdiction.state,
    record.jurisdiction.county ? `${record.jurisdiction.county} County` : null,
    record.jurisdiction.city,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Category: ${record.category}.`,
    where ? `Jurisdiction: ${where} (${record.jurisdiction.confidence}).` : "Jurisdiction: not established.",
    `Urgency: ${record.urgency.level}.`,
    factLines.length ? `Confirmed facts: ${factLines.join("; ")}.` : "Confirmed facts: none yet.",
    openLines.length ? `Unconfirmed: ${openLines.join("; ")}.` : null,
    record.missing.length ? `Still needed: ${record.missing.join(", ")}.` : "No blocking facts missing.",
    record.nextSteps.length
      ? `Next steps: ${record.nextSteps.map((step) => step.text).join(" ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
