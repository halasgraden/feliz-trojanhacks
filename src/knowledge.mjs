/**
 * Curated knowledge for the security-deposit MVP.
 *
 * Legal sentences below are short paraphrases of California Courts Self-Help,
 * checked against https://selfhelp.courts.ca.gov/guide-security-deposits-california
 * on 2026-10-17. They are not a copy of that page and they are not a complete
 * statement of Civil Code 1950.5. Machine-readable `rules` are the only numbers
 * the explainer is allowed to apply.
 */

export const DISCLAIMER =
  "This is legal information and navigation, not legal advice or representation. It does not predict the outcome of a case, and it can be wrong if the facts or the law are different from what is shown here.";

export const SOURCES = [
  {
    id: "ca-courts-deposit-return",
    title: "California Courts Self-Help: returning a security deposit",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    publisher: "California Courts Self-Help",
    jurisdiction: { state: "CA", county: null, city: null },
    topics: ["security_deposit"],
    lastVerified: "2026-10-17",
    keywords: ["21", "return", "itemized", "move-out", "deposit", "statement"],
    rules: { returnDeadlineDays: 21 },
    text: "California Courts Self-Help says that after a tenant moves out, the landlord has 21 days to return the full security deposit, or to return it minus any deductions along with an itemized statement that lists what was deducted and why.",
  },
  {
    id: "ca-courts-deposit-deductions",
    title: "California Courts Self-Help: what a deposit may cover",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    publisher: "California Courts Self-Help",
    jurisdiction: { state: "CA", county: null, city: null },
    topics: ["security_deposit"],
    lastVerified: "2026-10-17",
    keywords: ["deduct", "cleaning", "wear and tear", "damage", "unpaid rent"],
    rules: {},
    text: "California Courts Self-Help says a landlord may deduct for cleaning needed to return the unit to the condition it was in when the tenant moved in, for damage beyond normal wear and tear caused by the tenant or guests, for repair or replacement of furniture or personal items when the rental agreement covers those items and the damage is beyond normal wear and tear, and generally for unpaid rent. Some early move-outs tied to violence have extra limits.",
  },
  {
    id: "ca-courts-deposit-receipts",
    title: "California Courts Self-Help: receipts for larger deductions",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    publisher: "California Courts Self-Help",
    jurisdiction: { state: "CA", county: null, city: null },
    topics: ["security_deposit"],
    lastVerified: "2026-10-17",
    keywords: ["125", "receipt", "invoice", "hourly", "itemized"],
    rules: { receiptThresholdDollars: 125 },
    text: "California Courts Self-Help says that if deductions are for more than $125, the landlord must attach copies of invoices or receipts to the itemized statement. If the landlord or an employee did the work, the statement must describe the work, how long it took, and the hourly rate, and the rate must be reasonable.",
  },
  {
    id: "ca-courts-deposit-estimate",
    title: "California Courts Self-Help: repairs not finished within 21 days",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    publisher: "California Courts Self-Help",
    jurisdiction: { state: "CA", county: null, city: null },
    topics: ["security_deposit"],
    lastVerified: "2026-10-17",
    keywords: ["estimate", "14", "repairs", "good faith"],
    rules: { estimateFollowUpDays: 14 },
    text: "California Courts Self-Help says that if repairs are not finished within 21 days for a good reason, the landlord can send a good-faith estimate, and then must send the receipts within 14 days after the repairs are done.",
  },
  {
    id: "ca-courts-deposit-remedies",
    title: "California Courts Self-Help: asking for the deposit back",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    publisher: "California Courts Self-Help",
    jurisdiction: { state: "CA", county: null, city: null },
    topics: ["security_deposit"],
    lastVerified: "2026-10-17",
    keywords: ["letter", "small claims", "bad faith", "12500", "damages"],
    rules: { badFaithAdditionalMultiplier: 2, smallClaimsIndividualLimit: 12500 },
    text: "California Courts Self-Help says a tenant who disagrees with a deposit decision can write the landlord, keep a copy, and try to reach an agreement. If they cannot agree, the tenant can sue in small claims or civil court for the deposit and for two times the security deposit in damages. A judge may award those additional damages if the landlord kept the deposit in bad faith. A person who is a tenant can sue for up to $12,500 in small claims court.",
  },
];

export const RESOURCES = [
  {
    id: "ca-courts-self-help",
    name: "California Courts Self-Help",
    url: "https://selfhelp.courts.ca.gov/guide-security-deposits-california",
    coverage: { state: "CA", county: null, city: null },
    disputes: ["security_deposit"],
    eligibility: "Public court information for people in California. This is not a lawyer and not representation.",
    notes: "Start here for statewide security-deposit information.",
  },
  {
    id: "la-housing-department",
    name: "Los Angeles Housing Department",
    url: "https://housing.lacity.gov/",
    coverage: { state: "CA", county: "Los Angeles", city: "Los Angeles" },
    disputes: ["rent_increase", "eviction", "habitability"],
    eligibility: "City of Los Angeles programs. A property in Los Angeles County but outside the city is a different jurisdiction.",
    notes: "City housing agency. This MVP does not treat LAHD as the source of the statewide deposit rules.",
  },
  {
    id: "la-county-dcba",
    name: "Los Angeles County Department of Consumer and Business Affairs",
    url: "https://dcba.lacounty.gov/",
    coverage: { state: "CA", county: "Los Angeles", city: null },
    disputes: ["security_deposit", "eviction", "rent_increase"],
    eligibility: "Los Angeles County. Confirm the current service with DCBA.",
    notes: "County consumer and landlord-tenant information.",
  },
  {
    id: "stay-housed-la",
    name: "Stay Housed LA",
    url: "https://www.stayhousedla.org/",
    coverage: { state: "CA", county: "Los Angeles", city: null },
    disputes: ["eviction"],
    eligibility: "Los Angeles County renters facing eviction. Confirm eligibility on their site.",
    notes: "Eviction help. Prefer this when there is a notice, a court date, a lockout, or a utility shutoff.",
  },
  {
    id: "lafla",
    name: "Legal Aid Foundation of Los Angeles",
    url: "https://lafla.org/",
    coverage: { state: "CA", county: "Los Angeles", city: null },
    disputes: ["security_deposit", "eviction", "rent_increase"],
    eligibility: "Free help depends on income, location, and capacity. LAFLA decides whether it can take a matter.",
    notes: "Legal aid for people with limited income in Los Angeles.",
  },
];

export function sourceById(id) {
  return SOURCES.find((source) => source.id === id) ?? null;
}
