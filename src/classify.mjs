const CATEGORIES = ["security_deposit", "eviction", "rent_increase", "other"];

const EVICTION =
  /\b(evict(?:ion|ed|ing)?|unlawful detainer|notice to quit|3-day notice|three-day notice|lock(?:ed)? (?:me )?out|changed the locks|sheriff)\b/i;
const DEPOSIT =
  /\b(security deposit|deposit)\b|\b(withheld|kept|deducted)\b[^.]{0,40}\b(deposit|\$)/i;
const RENT =
  /\b(rent increase|raised (?:the |my )?rent|increasing (?:the |my )?rent|rent went up)\b/i;

export function classifyHousingIssue(message, priorCategory = "unknown") {
  const text = message ?? "";
  let category = "unknown";
  let confidence = "low";

  if (EVICTION.test(text)) {
    category = "eviction";
    confidence = "high";
  } else if (DEPOSIT.test(text)) {
    category = "security_deposit";
    confidence = "high";
  } else if (RENT.test(text)) {
    category = "rent_increase";
    confidence = "high";
  } else if (/\b(landlord|rental|apartment|tenant)\b/i.test(text)) {
    category = "other";
    confidence = "low";
  }

  if (category === "unknown" && CATEGORIES.includes(priorCategory) && priorCategory !== "unknown") {
    return { category: priorCategory, confidence: "carried_forward", fromMessage: false };
  }

  return { category, confidence, fromMessage: category !== "unknown" };
}

export function classifyTranscript(transcript, priorCategory = "unknown") {
  const fresh = classifyHousingIssue(transcript, "unknown");
  if (fresh.category !== "unknown") return fresh;
  return classifyHousingIssue("", priorCategory);
}
