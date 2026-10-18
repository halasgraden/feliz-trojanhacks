export type Urgency = {
  level: "routine" | "urgent";
  reasons: string[];
};

export function checkUrgency(text: string): Urgency {
  const reasons: string[] = [];
  if (/lock(ed|s)? me out|changed the locks|lockout/i.test(text)) reasons.push("The message describes a lockout.");
  if (/shut ?off|turned off/i.test(text) && /water|power|gas|electric/i.test(text)) {
    reasons.push("The message describes a utility shutoff.");
  }
  if (/eviction notice|3-day notice|three-day notice|notice to quit|court date/i.test(text)) {
    reasons.push("The message describes an eviction notice or court date.");
  }
  return { level: reasons.length ? "urgent" : "routine", reasons };
}
