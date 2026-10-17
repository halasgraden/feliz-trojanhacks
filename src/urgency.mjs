const URGENT = [
  { id: "lockout", pattern: /\b(changed the locks|locked me out|lockout)\b/i, reason: "A lockout was described." },
  {
    id: "utility_shutoff",
    pattern: /\b(shut ?off|turned off)\b[^.]{0,40}\b(water|power|electricity|gas|utilities)\b/i,
    reason: "A utility shutoff was described.",
  },
  { id: "court", pattern: /\b(court date|unlawful detainer|sheriff)\b/i, reason: "A court or sheriff step was mentioned." },
  {
    id: "notice",
    pattern: /\b(3-day notice|three-day notice|eviction notice|notice to quit)\b/i,
    reason: "An eviction notice was mentioned.",
  },
];

export function checkUrgency(text, facts = {}) {
  const reasons = [];
  for (const signal of URGENT) {
    if (signal.pattern.test(text ?? "") || facts[signal.id] === true) reasons.push(signal.reason);
  }
  if (facts.lockout) reasons.push("A lockout was described.");
  if (facts.utilityShutoff) reasons.push("A utility shutoff was described.");
  if (facts.noticeMentioned) reasons.push("An eviction notice was mentioned.");

  const unique = [...new Set(reasons)];
  return {
    level: unique.length ? "urgent" : "routine",
    reasons: unique,
  };
}
