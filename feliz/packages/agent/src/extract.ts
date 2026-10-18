import type { CaseFacts } from "@feliz/db";
import { countyFor, type Requirement } from "@feliz/routing";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const KNOWN_CITIES = ["Los Angeles", "Santa Monica"];

export function extractFacts(message: string, today = "2026-10-17"): CaseFacts {
  const facts: CaseFacts = {};
  const withheld = message.match(/\b(?:kept|withheld|holding|took|deducted)\s+\$(\d{1,3}(?:,\d{3})*|\d+)/i);
  if (withheld) facts.amountWithheld = Number(withheld[1].replace(/,/g, ""));
  const deposit = message.match(/\b(?:deposit (?:was|of|is)|security deposit of|full deposit (?:was|of|is))\s+\$(\d{1,3}(?:,\d{3})*|\d+)/i);
  if (deposit) facts.depositAmount = Number(deposit[1].replace(/,/g, ""));

  if (/\b(no itemized|never (?:sent|got|received) an itemized|without an itemized|did not (?:send|give|provide)(?: me)? an itemized|didn't (?:send|give|provide)(?: me)? an itemized)\b/i.test(message)) {
    facts.itemizedStatement = "no";
  } else if (/\b(gave me an itemized|sent an itemized|received an itemized)\b/i.test(message)) {
    facts.itemizedStatement = "yes";
  }

  if (/\bunincorporated\b/i.test(message)) {
    facts.unincorporated = true;
    facts.county = "Los Angeles";
  } else {
    const city = latestKnownCity(message) ?? capitalizedCity(message);
    if (city) {
      facts.city = city;
      facts.unincorporated = false;
      const county = countyFor(city);
      if (county) facts.county = county;
    }
  }

  const dated = findDate(message, today);
  if (dated && /\b(moved out|move-?out|left the (?:unit|apartment)|returned the keys)\b/i.test(message)) facts.moveOutDate = dated;
  if (dated && /\bnotice\b/i.test(message)) facts.noticeDate = dated;
  return facts;
}

export function proposeField(field: Requirement, text: string): string | null {
  if (field === "whatHappened") return null;
  const facts = extractFacts(text);
  const value = facts[field];
  return value == null || value === "" ? null : String(value);
}

export function isYes(text: string): boolean {
  return /^(yes|yeah|yep|correct|that's right|thats right)\b/i.test(text.trim());
}

export function isNo(text: string): boolean {
  return /^(no|nope|not yet|incorrect)\b/i.test(text.trim());
}

function latestKnownCity(message: string): string | null {
  const lower = message.toLowerCase();
  let found: { city: string; index: number } | null = null;
  for (const city of KNOWN_CITIES) {
    const index = lower.lastIndexOf(city.toLowerCase());
    if (index >= 0 && (!found || index > found.index)) found = { city, index };
  }
  return found?.city ?? null;
}

function capitalizedCity(message: string): string | null {
  const match = message.match(/\b(?:in|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  return match?.[1] ?? null;
}

function findDate(text: string, today: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return toIso(Number(us[3]), Number(us[1]), Number(us[2]));
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/i);
  if (!named) return null;
  const month = MONTHS[named[1].toLowerCase()];
  const day = Number(named[2]);
  const year = named[3] ? Number(named[3]) : inferYear(month, day, today);
  return toIso(year, month, day);
}

function inferYear(month: number, day: number, today: string): number {
  const current = new Date(`${today}T00:00:00Z`);
  const year = current.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  if (candidate > current.getTime() + 24 * 60 * 60 * 1000) return year - 1;
  return year;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
