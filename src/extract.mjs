import { parseLocation } from "./jurisdiction.mjs";

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function extractCaseFacts(message, context = {}) {
  const text = message ?? "";
  const confirmed = {};
  const unconfirmed = {};

  Object.assign(confirmed, shortReply(text, context));

  const withheld = matchAmount(text, /\b(?:kept|withheld|holding|took|deducted)\s+\$(\d{1,3}(?:,\d{3})*|\d+)/i);
  const deposit = matchAmount(
    text,
    /\b(?:deposit (?:was|of|is)|security deposit of|full deposit (?:was|of|is)|paid)\s+\$(\d{1,3}(?:,\d{3})*|\d+)/i,
  );
  if (withheld != null) confirmed.amountWithheld = withheld;
  if (deposit != null) confirmed.depositAmount = deposit;

  const moveOut = findMoveOutDate(text, context.today);
  if (moveOut) confirmed.moveOutDate = moveOut;

  if (/\b(no itemized|did not (?:send|give|provide)(?: me)? an itemized|didn't (?:send|give|provide)(?: me)? an itemized|never (?:sent|got|received) an itemized|without an itemized)\b/i.test(text)) {
    confirmed.itemizedStatement = "no";
  } else if (/\b(itemized (?:statement|list)[^.]{0,40}\b(received|gave|sent|provided)|gave me an itemized|sent an itemized)\b/i.test(text)) {
    confirmed.itemizedStatement = "yes";
  }

  if (/\b(won'?t explain|will not explain|never explained|did not explain|didn't explain|no explanation)\b/i.test(text)) {
    confirmed.landlordExplained = false;
  }

  const location = parseLocation(text);
  if (location.outsideCalifornia) confirmed.outsideCalifornia = true;
  if (location.state && location.confidence === "confirmed") confirmed.state = location.state;
  if (location.county && location.confidence === "confirmed") confirmed.county = location.county;
  if (location.city && location.confidence === "confirmed") confirmed.city = location.city;
  if (location.city && location.confidence === "unconfirmed") unconfirmed.city = location.city;
  if (location.state && location.confidence === "unconfirmed") unconfirmed.state = location.state;

  if (/\b(changed the locks|locked me out|lockout)\b/i.test(text)) confirmed.lockout = true;
  if (/\b(shut ?off|turned off)\b[^.]{0,30}\b(water|power|electricity|gas|utilities)\b/i.test(text)) {
    confirmed.utilityShutoff = true;
  }
  if (/\b(3-day notice|three-day notice|eviction notice|notice to quit)\b/i.test(text)) {
    confirmed.noticeMentioned = true;
  }

  return { confirmed, unconfirmed };
}

function shortReply(text, context) {
  if (!/^\s*(yes|no|yeah|yep|nope|not yet)\s*\.?\s*$/i.test(text)) return {};
  const asks = context.followUps ?? [];
  const yesNo = asks.filter((item) => item.id === "itemizedStatement");
  if (asks.length !== 1 || yesNo.length !== 1) return {};
  return { itemizedStatement: /^n/i.test(text.trim()) ? "no" : "yes" };
}

function matchAmount(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function findMoveOutDate(text, today) {
  if (!/\b(moved out|move-?out|left the (?:unit|apartment)|returned the keys|vacated)\b/i.test(text)) {
    return null;
  }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return toIso(Number(us[3]), Number(us[1]), Number(us[2]));
  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/i,
  );
  if (!named) return null;
  const month = MONTHS[named[1].toLowerCase()];
  const day = Number(named[2]);
  const year = named[3] ? Number(named[3]) : inferYear(month, day, today);
  return toIso(year, month, day);
}

function inferYear(month, day, today) {
  const current = today ? new Date(`${today}T00:00:00Z`) : new Date();
  const year = current.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  if (candidate > current.getTime() + 24 * 60 * 60 * 1000) return year - 1;
  return year;
}

function toIso(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
