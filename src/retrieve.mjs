import { RESOURCES, SOURCES } from "./knowledge.mjs";

const DEPOSIT_CORE = [
  "ca-courts-deposit-return",
  "ca-courts-deposit-deductions",
  "ca-courts-deposit-remedies",
];

export function searchLegalSources(record) {
  if (record.category !== "security_deposit") return [];
  if (record.jurisdiction.confidence === "out_of_scope") return [];
  if (!record.jurisdiction.state) return [];

  const ids = new Set(DEPOSIT_CORE);
  const withheld = record.facts.amountWithheld;
  if (record.facts.itemizedStatement === "yes" || (typeof withheld === "number" && withheld > 125)) {
    ids.add("ca-courts-deposit-receipts");
  }
  if (/\bestimate\b/i.test(userBlob(record))) ids.add("ca-courts-deposit-estimate");

  return SOURCES.filter((source) => ids.has(source.id));
}

export function findHousingResources(record) {
  const category = record.category;
  const { state, county, city, confidence } = record.jurisdiction;
  const urgent = record.urgency.level === "urgent" || category === "eviction";
  const inLosAngelesCounty = state === "CA" && (county === "Los Angeles" || city === "Los Angeles");
  const inLosAngelesCity = state === "CA" && city === "Los Angeles";

  return RESOURCES.filter((resource) => {
    if (resource.id === "ca-courts-self-help") {
      return category === "security_deposit" && state === "CA";
    }
    if (resource.id === "la-housing-department") {
      return inLosAngelesCity && (category === "rent_increase" || category === "eviction" || category === "other");
    }
    if (resource.id === "la-county-dcba") return inLosAngelesCounty;
    if (resource.id === "lafla") return inLosAngelesCounty;
    if (resource.id === "stay-housed-la") {
      return urgent && (inLosAngelesCounty || confidence === "missing" || confidence === "low");
    }
    return false;
  });
}

function userBlob(record) {
  return (record.turns ?? [])
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join("\n");
}
