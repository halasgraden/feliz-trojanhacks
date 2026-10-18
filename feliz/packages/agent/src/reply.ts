import type { LegalChunk, PendingFact, Referral } from "@feliz/db";
import { sourceLine } from "@feliz/rag";

export const DISCLAIMER = "This is legal information and navigation, not legal advice or representation.";

export const NOT_COVERED = "The stored housing documents do not cover this.";

const URGENT_LINE =
  "This sounds time-sensitive. If you are locked out or without utilities, contact local eviction help before spending time on a written dispute.";

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
  return `From the file ${pending.sourceLabel}: the ${label} looks like ${pending.value}. Is that right?`;
}

export function composeFromChunks(chunks: LegalChunk[]): string {
  if (chunks.length === 0) return NOT_COVERED;
  const lines = ["From the stored documents", ""];
  for (const chunk of chunks.slice(0, 3)) {
    lines.push(`- ${chunk.body.trim()}`);
    lines.push(`  ${sourceLine(chunk)}`);
  }
  return lines.join("\n");
}

export function presentReply(body: string, options: { urgent: boolean; referrals: Referral[] }): string {
  const lines = [DISCLAIMER, ""];
  if (options.urgent) lines.push(URGENT_LINE, "");
  lines.push(body);
  if (options.referrals.length) {
    lines.push("", "Where to get help");
    for (const referral of options.referrals) {
      lines.push(`- ${referral.name}: ${referral.url}`);
      lines.push(`  Referral only. ${referral.notes}`);
    }
  }
  return lines.join("\n");
}
