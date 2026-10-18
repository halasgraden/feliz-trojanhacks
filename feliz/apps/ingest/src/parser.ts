import { BOILERPLATE, OUTDATED_SENTENCES, PAGE_TAGS, type PageTags } from "./sources.js";

/** One line of webscraper/data/processed/documents.jsonl (document_schema.py). */
export interface ScrapedDocument {
  document_id: string;
  title: string;
  source_url: string;
  source_name: string;
  content_type: string;
  text: string;
  content_hash: string;
  last_fetched_at: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  documentId: string;
  url: string;
  publisher: string;
  title: string;
  fetchedAt: string; // YYYY-MM-DD
  contentHash: string;
  text: string; // cleaned page text
  tags: PageTags;
  raw: ScrapedDocument; // the scraper's record, stored as-is in legal_sources
}

export function parseJsonl(jsonl: string): ScrapedDocument[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const d = JSON.parse(line) as ScrapedDocument;
      for (const field of ["document_id", "source_url", "source_name", "text", "content_hash", "last_fetched_at"] as const) {
        if (!d[field]) throw new Error(`documents.jsonl line ${i + 1}: missing ${field}`);
      }
      return d;
    });
}

/** Throws for a page with no entry in PAGE_TAGS: an untagged page would be guessed into the wrong scope. */
export function parseDocument(doc: ScrapedDocument): ParsedDocument {
  const tags = PAGE_TAGS[doc.source_url];
  if (!tags) throw new Error(`No PAGE_TAGS entry for ${doc.source_url}; add one in apps/ingest/src/sources.ts`);
  return {
    documentId: doc.document_id,
    url: doc.source_url,
    publisher: doc.source_name.trim(),
    title: citationSafe(tags.title ?? cleanTitle(doc.title)),
    fetchedAt: doc.last_fetched_at.slice(0, 10),
    contentHash: doc.content_hash,
    text: removeOutdated(cleanText(doc.text, new URL(doc.source_url).host), doc.source_url),
    tags,
    raw: doc,
  };
}

/**
 * The scraper decoded some UTF-8 as Latin-1 and dropped the continuation bytes, leaving
 * a lone "â" where a curly quote, apostrophe, or dash was. They can't be restored exactly,
 * so pick by position: between spaces or digits it was a dash, attached to a word a quote.
 */
export function fixMojibake(text: string): string {
  return text
    .replace(/Â(?=\s|$)/g, "") // "Â" before a space was a non-breaking space
    .replace(/(?<=[\d\s.])â(?=[\s\d])|â(?=\d)/g, "–") // "Monday â Friday", "9 a.m.â5", "amâ12:00"
    .replace(/(?<=\w)â(?=\w)/g, "'") // driverâs -> driver's
    .replace(/â/g, "'");
}

function removeOutdated(text: string, url: string): string {
  let t = text;
  for (const o of OUTDATED_SENTENCES.filter((o) => o.url === url)) {
    if (!o.sentence.test(t)) throw new Error(`OUTDATED_SENTENCES no longer matches ${url}; recheck the page (${o.sentence})`);
    t = t.replace(o.sentence, "").replace(/\s+/g, " ").trim();
  }
  return t;
}

export function cleanText(text: string, host: string): string {
  let t = fixMojibake(text);
  const rules = BOILERPLATE.find((b) => b.host === host);
  if (rules) {
    for (const cut of rules.cutAt) {
      const m = cut.exec(t);
      if (m) t = t.slice(0, m.index);
    }
    for (const pattern of rules.remove) t = t.replace(pattern, "");
  }
  t = dropRepeatedBreadcrumb(t);
  return t.replace(/\s+/g, " ").trim();
}

/** "Rent Registry Here you will find Rent Registry Rent Registry is ..." -> "Rent Registry is ..." */
function dropRepeatedBreadcrumb(t: string): string {
  const marker = " Here you will find ";
  const at = t.indexOf(marker);
  if (at < 0 || at > 200) return t;
  const crumb = t.slice(0, at);
  const rest = t.slice(at + marker.length);
  return rest.startsWith(crumb) ? rest.slice(crumb.length).trimStart() : rest;
}

const SITE_SUFFIXES = [/\s+[–-]\s+Consumer & Business$/, /\s+-\s+LAFLA: Legal Aid Foundation of Los Angeles$/, /\s+\|\s+Stay Housed LA$/];

export function cleanTitle(title: string): string {
  let t = fixMojibake(title).replace(/https?:\/\/\S+/g, "").trim();
  for (const s of SITE_SUFFIXES) t = t.replace(s, "");
  return t.trim();
}

/** citationsInReply() can't parse a title containing a double quote. */
function citationSafe(title: string): string {
  return title.replace(/["“”]/g, "'").replace(/\s+/g, " ").trim();
}
