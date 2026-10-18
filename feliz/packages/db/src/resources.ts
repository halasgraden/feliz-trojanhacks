import type { CaseFacts, Referral } from "./cases.js";

export const REFERRALS: Referral[] = [
  {
    id: "la-housing-department",
    name: "Los Angeles Housing Department",
    url: "https://housing.lacity.gov/",
    state: "CA",
    county: "Los Angeles",
    city: "Los Angeles",
    disputes: ["rent_increase", "eviction"],
    notes: "City of Los Angeles housing agency. A Los Angeles County address outside the city is a different jurisdiction.",
  },
  {
    id: "la-county-dcba",
    name: "Los Angeles County Department of Consumer and Business Affairs",
    url: "https://dcba.lacounty.gov/",
    state: "CA",
    county: "Los Angeles",
    city: null,
    disputes: ["security_deposit", "eviction", "rent_increase"],
    notes: "County consumer and landlord-tenant information.",
  },
  {
    id: "stay-housed-la",
    name: "Stay Housed LA",
    url: "https://www.stayhousedla.org/",
    state: "CA",
    county: "Los Angeles",
    city: null,
    disputes: ["eviction"],
    notes: "Eviction help for Los Angeles County renters. Confirm eligibility on their site.",
  },
  {
    id: "lafla",
    name: "Legal Aid Foundation of Los Angeles",
    url: "https://lafla.org/",
    state: "CA",
    county: "Los Angeles",
    city: null,
    disputes: ["security_deposit", "eviction", "rent_increase"],
    notes: "Legal aid. LAFLA decides whether it can take a matter.",
  },
];

export function matchReferrals(referrals: Referral[], facts: CaseFacts, category: string): Referral[] {
  return referrals.filter((referral) => {
    if (referral.city && referral.city !== facts.city) return false;
    if (referral.county && referral.county !== facts.county) return false;
    if (!facts.city && !facts.county) return false;
    if (category === "unknown" || category === "other") return true;
    return referral.disputes.includes(category);
  });
}
