import type { ParsedDocument } from "./parser.js";

export interface Section {
  id: string; // "{documentId}_{index}", index from 0
  heading: string;
  body: string;
}

const TARGET_CHARS = 700; // short enough to quote, per docs/rag-supabase.md
const MAX_CHARS = 1000;
const MIN_CHARS = 60;
// How far a question heading reaches. The pages' non-question headings aren't detectable in
// flat text, so past this the text more likely belongs to an unseen section: fall back to
// the page title rather than cite a specific but wrong "Section:".
const HEADING_SPAN_CHARS = 1400;

// Words that end a sentence-like token without ending a sentence.
const ABBREVIATIONS = /(?:\b(?:a\.m|p\.m|Cal|Civ|Proc|Gov|Code|St|Ave|Blvd|No|Nos|Rev|Inc|Corp|Mr|Mrs|Ms|Dr|vs|etc|e\.g|i\.e|U\.S|L\.A)|§)\.$/i;

const QUESTION_START = /\b(?:What|How|Can|Could|Do|Does|Is|Are|When|Who|Where|Why|Which|Will|Should|If|May|Am)\b/i;

/**
 * Scraped text is flat: no blank lines, no markdown headings. Sections are found from
 * the page's own question headings ("What is harassment?"); everything else is grouped
 * under the nearest preceding heading, or the page title. Headings and bodies are always
 * the page's own words, so every quoted sentence can be traced to the source.
 */
export function chunkDocument(doc: ParsedDocument): Section[] {
  const groups: { heading: string; units: string[]; chars: number }[] = [{ heading: doc.title, units: [], chars: 0 }];
  const current = () => groups[groups.length - 1];
  const add = (unit: string) => {
    if (current().heading !== doc.title && current().chars + unit.length > HEADING_SPAN_CHARS) {
      groups.push({ heading: doc.title, units: [], chars: 0 });
    }
    current().units.push(unit);
    current().chars += unit.length;
  };
  for (const unit of splitSentences(doc.text)) {
    const split = splitHeading(unit);
    if (split) {
      if (split.before) add(split.before);
      groups.push({ heading: split.heading, units: [], chars: 0 });
    } else {
      add(unit);
    }
  }

  const sections: Omit<Section, "id">[] = [];
  for (const g of groups) {
    for (const body of pack(g.units)) sections.push({ heading: g.heading, body });
  }
  // Fold slivers into the previous section with the same heading, or drop them.
  const kept: Omit<Section, "id">[] = [];
  for (const s of sections) {
    const prev = kept[kept.length - 1];
    if (s.body.length >= MIN_CHARS) kept.push(s);
    else if (prev && prev.heading === s.heading && prev.body.length + s.body.length <= MAX_CHARS) prev.body += ` ${s.body}`;
  }
  return kept.map((s, i) => ({ id: `${doc.documentId}_${i}`, ...s }));
}

export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9$])/);
  const out: string[] = [];
  for (const p of parts) {
    // "(AB 2347) The resources..." continues the previous sentence; keep a rule with its qualifier.
    if (out.length && (ABBREVIATIONS.test(out[out.length - 1]) || p.startsWith("("))) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * A short sentence ending in "?" is a heading. Text before the question word is either a
 * parent heading in Title Case ("Know Your Rights What is harassment?"), which is dropped,
 * or body text that belongs to the previous section.
 */
export function splitHeading(unit: string): { heading: string; before: string } | null {
  if (!unit.endsWith("?") || unit.split(/\s+/).length > 18) return null;
  const m = QUESTION_START.exec(unit);
  if (!m || !/^[A-Z]/.test(m[0])) return null;
  const heading = unit.slice(m.index).trim();
  if (heading.split(/\s+/).length < 3) return null;
  let before = unit.slice(0, m.index).trim();
  if (before && isTitleCase(before)) before = "";
  return { heading, before };
}

function isTitleCase(s: string): boolean {
  const words = s.split(/\s+/);
  return words.length <= 6 && words.every((w) => /^[A-Z0-9&]/.test(w) || /^(?:and|of|the|to|for|a|in|your)$/.test(w));
}

/** Greedily pack sentences into bodies of ~TARGET_CHARS, splitting any single over-long sentence. */
function pack(units: string[]): string[] {
  const bodies: string[] = [];
  let cur = "";
  for (const unit of units.flatMap(splitLong)) {
    if (cur && cur.length + unit.length + 1 > TARGET_CHARS) {
      bodies.push(cur);
      cur = unit;
    } else {
      cur = cur ? `${cur} ${unit}` : unit;
    }
  }
  if (cur) bodies.push(cur);
  return bodies;
}

function splitLong(unit: string): string[] {
  if (unit.length <= MAX_CHARS) return [unit];
  const out: string[] = [];
  let rest = unit;
  while (rest.length > MAX_CHARS) {
    const cut = rest.lastIndexOf(" ", TARGET_CHARS);
    out.push(rest.slice(0, cut > 0 ? cut : TARGET_CHARS));
    rest = rest.slice(cut > 0 ? cut + 1 : TARGET_CHARS);
  }
  return [...out, rest];
}
