import type { CaseFacts, LegalChunk, PendingFact, Referral } from "@feliz/db";
import { sourceLine } from "@feliz/rag";

export const DISCLAIMER = "This is legal information and navigation, not legal advice or representation.";

export const NOT_COVERED = "I don't have a document that covers this.";

const URGENT_LINE =
  "This sounds urgent. If you're locked out or your utilities were shut off, get eviction help before you spend time writing a letter.";

export function offerFor(category: string, facts: CaseFacts): string {
  if (category === "security_deposit") {
    const amount = typeof facts.amountWithheld === "number" ? `the $${facts.amountWithheld} and ` : "";
    return `Want me to draft a short email asking for ${amount}a written list of what they kept?`;
  }
  if (category === "eviction") {
    return "Want me to draft a short text asking them to let you back in, and saying a lockout has to go through court?";
  }
  if (category === "rent_increase") {
    return "Want me to draft a short email asking which rent rule covers your place, and for the written notice?";
  }
  return "Want to keep going? Ask me anything else, or I can help you draft a text or email.";
}

const FIELD_LABELS: Record<string, string> = {
  city: "city",
  moveOutDate: "move-out date",
  itemizedStatement: "itemized-statement answer",
  amountWithheld: "amount still held",
  depositAmount: "deposit amount",
  noticeDate: "notice date",
  county: "county",
};

export function confirmationLine(pending: PendingFact): string {
  const label = FIELD_LABELS[pending.field] ?? pending.field;
  return `From the file you sent, the ${label} looks like ${pending.value}. Is that right?`;
}

export function composeFromChunks(chunks: LegalChunk[]): string {
  const usable = chunks.filter((chunk) => !isPageChrome(chunk.body)).slice(0, 2);
  if (usable.length === 0) return NOT_COVERED;
  return usable.map((chunk) => `${shorten(chunk.body)}\n${sourceLine(chunk)}`).join("\n\n");
}

function isPageChrome(body: string): boolean {
  return /index:\s*all pages|print\s+email|enter your email/i.test(body);
}

export type PresentedReply = { texts: string[]; reply: string };

/** One text per idea. The disclaimer is only included on the first message of a case. */
export function presentReply(
  body: string,
  options: { first: boolean; urgent: boolean; referrals: Referral[]; offer?: string },
): PresentedReply {
  const texts: string[] = [];
  if (options.first) texts.push(DISCLAIMER);
  if (options.urgent) texts.push(URGENT_LINE);
  texts.push(...answerBubbles(body));
  for (const referral of options.referrals) texts.push(referralText(referral));
  if (options.offer) texts.push(options.offer);
  return { texts, reply: texts.join("\n\n") };
}

function answerBubbles(body: string): string[] {
  if (!body.includes("Source:")) {
    return body
      .split("\n")
      .map((line) => everyday(line.trim()))
      .filter(Boolean);
  }
  const bubbles: string[] = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const prose = lines.filter((line) => !line.startsWith("Source:")).join(" ");
    const source = lines.find((line) => line.startsWith("Source:"));
    if (!prose) continue;
    const text = source ? `${everyday(prose)}\n\n${friendlySource(source)}` : everyday(prose);
    bubbles.push(text);
  }
  return bubbles;
}

function friendlySource(line: string): string {
  const match = line.match(/^Source:\s*(.+?),\s*"[^"]*",\s*(\S+),/);
  if (!match) return line;
  return `From ${match[1]}: ${match[2]}`;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  if (sentences.length <= 320) return sentences;
  return `${sentences.slice(0, 300).replace(/\s+\S*$/, "")}…`;
}

function everyday(text: string): string {
  return text
    .replace(/\bthe tenant\b/gi, "you")
    .replace(/\btenants\b/gi, "renters")
    .replace(/\btenant\b/gi, "renter")
    .replace(/\bRent Stabilization Ordinance\b/gi, "city rent rules")
    .replace(/\bconstructive eviction\b/gi, "being locked out or having the utilities shut off")
    .replace(/\s+/g, " ")
    .trim();
}

function referralText(referral: Referral): string {
  return `If you want someone to talk this through with you, try ${referral.name}: ${referral.url}`;
}
