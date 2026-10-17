import type { Jurisdiction } from "@feliz/db";

/**
 * Which rules each source speaks to, and how much to trust it.
 * authority: 1 = statute (source of truth), 2 = government agency, 3 = legal aid / nonprofit.
 * Add an entry for each new scraper source; unknown sources default to statewide, authority 3.
 */
export const SOURCE_META: Record<string, { jurisdictions: Jurisdiction[]; authority: 1 | 2 | 3 }> = {
  statutes: { jurisdictions: ["california"], authority: 1 },
  lahd: { jurisdictions: ["city_of_la"], authority: 2 },
  dcba: { jurisdictions: ["la_county"], authority: 2 },
  courts: { jurisdictions: ["california"], authority: 2 },
  stayhousedla: { jurisdictions: ["city_of_la", "la_county"], authority: 3 },
  lafla: { jurisdictions: ["city_of_la", "la_county"], authority: 3 },
  lawhelpca: { jurisdictions: ["california"], authority: 3 },
};

export function metaFor(source: string) {
  return SOURCE_META[source] ?? { jurisdictions: ["california"] as Jurisdiction[], authority: 3 as const };
}
