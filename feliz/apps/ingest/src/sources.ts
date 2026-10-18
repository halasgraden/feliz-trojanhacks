import type { Topic } from "@feliz/db";

/**
 * Per-page tags for the scraped corpus (webscraper/data/processed/documents.jsonl).
 * The scraper records no city, county, or topic, so they are set here by hand.
 * See docs/rag-supabase.md: a wrong topic hides a page from the category that needs it,
 * and `city` set to a city restricts the page to renters confirmed in that city.
 *
 * `title` overrides a scraped title that is missing, generic, or polluted.
 */
export interface PageTags {
  topics: Topic[];
  city: string | null;
  county: string | null;
  state: string;
  title?: string;
  note?: string;
}

const LA_COUNTY = { county: "Los Angeles", state: "CA" } as const;
const STATEWIDE = { county: null, state: "CA" } as const;

export const PAGE_TAGS: Record<string, PageTags> = {
  // DCBA (LA County)
  "https://dcba.lacounty.gov/mediation/": {
    topics: ["eviction", "security_deposit"], city: null, ...LA_COUNTY, title: "Mediation",
    note: "Court mediation for unlawful detainer and small claims cases.",
  },
  "https://dcba.lacounty.gov/rentregistry/": {
    topics: ["rent_increase"], city: null, ...LA_COUNTY,
    note: "Unincorporated LA County only; county is not a search filter yet.",
  },
  "https://dcba.lacounty.gov/pricegouging/": { topics: ["rent_increase"], city: null, ...LA_COUNTY },
  "https://dcba.lacounty.gov/news/understanding-rent-increases/": {
    topics: ["rent_increase"], city: null, ...LA_COUNTY,
    title: "Understanding Rent Increases in Los Angeles: What You Need to Know",
  },
  "https://dcba.lacounty.gov/legal-access-centers/": { topics: ["eviction"], city: null, ...LA_COUNTY },
  "https://dcba.lacounty.gov/rentstabilizationprogram/": {
    topics: ["rent_increase", "eviction"], city: null, ...LA_COUNTY,
    note: "Unincorporated LA County only; county is not a search filter yet.",
  },
  "https://dcba.lacounty.gov/after-the-disaster-information-for-landlords-and-tenants/": {
    topics: ["security_deposit", "eviction"], city: null, ...LA_COUNTY,
  },

  // Stay Housed LA
  "https://www.stayhousedla.org/": {
    topics: ["eviction"], city: null, ...LA_COUNTY, title: "Understand and protect your rights as a tenant",
  },

  // LAFLA
  "https://lafla.org/get-help/housing-and-eviction/": { topics: ["eviction"], city: null, ...LA_COUNTY },
  "https://lafla.org/get-help/housing-homelessness/": { topics: ["eviction"], city: null, ...LA_COUNTY },
  "https://lafla.org/get-help/tenant-harassment/": {
    topics: ["eviction"], city: "Los Angeles", ...LA_COUNTY,
    note: "Describes the City of Los Angeles Tenant Anti-Harassment Ordinance; the page says so itself.",
  },
  "https://lafla.org/get-help/veterans/": {
    topics: ["eviction"], city: null, ...LA_COUNTY, note: "Mostly benefits; housing help is one line.",
  },
  "https://lafla.org/who-we-are/locations/": {
    topics: ["eviction"], city: null, ...LA_COUNTY, note: "Office addresses and hours, not law.",
  },

  // LawHelpCA (statewide)
  "https://www.lawhelpca.org/issues/housing": {
    topics: ["eviction"], city: null, ...STATEWIDE, title: "Housing",
    note: "States the 10-court-day eviction response deadline (AB 2347).",
  },
  "https://www.lawhelpca.org/resource/new-california-law-requires-landlords-to-provide-working-fridge-and-stove-in-all-apartments": {
    topics: [], city: null, ...STATEWIDE,
    title: "New California Law Requires Landlords to Provide Working Fridge and Stove in All Apartments",
    note: "Habitability; no matching case category, so left open to all.",
  },
  "https://www.lawhelpca.org/resource/tenant-background-checks-and-your-rights": {
    topics: [], city: null, ...STATEWIDE, title: "Tenant Background Checks and Your Rights",
    note: "Screening before a lease; no matching case category, so left open to all.",
  },
};

/** Navigation and footer text per site, removed before chunking. Patterns match the flattened text. */
export const BOILERPLATE: { host: string; remove: RegExp[]; cutAt: RegExp[] }[] = [
  {
    host: "dcba.lacounty.gov",
    remove: [
      /^FILE A COMPLAINT \| REQUEST MEDIATION \| ASK A QUESTION \| ABOUT US X Facebook Instagram YouTube /,
      /(?:https?:)?\/\/\S+\.(?:png|jpe?g|gif|svg)(?: \d+ \d+)?/g,
      /Consumer & Business Consumer & Business /g,
      /Styled Table(?: \d+)? /g,
    ],
    cutAt: [/ (?:Search )?Get Help Facebook X Instagram YouTube Contact Us\s*$/],
  },
  {
    host: "lafla.org",
    remove: [/^Skip to content /, /Know Your Rights Subtitles are available in:.*?MORE VIDEOS /],
    cutAt: [/ Notice All LAFLA offices will be closed/, / Resource Library English /],
  },
  {
    host: "www.lawhelpca.org",
    remove: [
      /^Search for Your Issue /,
      /Disaster Information Scam Alerts Interactions with ICE Find 211 Resources for Non-Legal Needs Top Resources .*?View all /,
      /Landlord and Tenant Issues Safe and Healthy Housing .*?Back to All Topics/, // housing index sub-topic menu
      /Contents Link Information Link: \S+ Information /,
    ],
    cutAt: [/ Featured Guides We have created the following guides/],
  },
  { host: "www.stayhousedla.org", remove: [], cutAt: [] },
];

/**
 * Sentences a page still states that are no longer the law. They are removed before chunking
 * (the rest of the page is kept), because the agent would otherwise quote them as current.
 */
export const OUTDATED_SENTENCES: { url: string; sentence: RegExp; reason: string }[] = [
  {
    url: "https://lafla.org/get-help/tenant-harassment/",
    sentence: /You only have 5 days to answer the lawsuit once you get the eviction lawsuit papers\./,
    reason: "AB 2347: 10 court days to respond to an eviction case as of January 1, 2025 (stated on lawhelpca.org/issues/housing).",
  },
];
