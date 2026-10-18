export type Category = "security_deposit" | "eviction" | "rent_increase" | "other" | "unknown";

export type Requirement = "whatHappened" | "city" | "moveOutDate" | "itemizedStatement" | "amountWithheld" | "noticeDate";

export type FactSnapshot = {
  city?: string;
  county?: string;
  unincorporated?: boolean;
  moveOutDate?: string;
  itemizedStatement?: "yes" | "no";
  amountWithheld?: number;
  depositAmount?: number;
  noticeDate?: string;
};

const REQUIRED: Record<Category, Requirement[]> = {
  unknown: ["whatHappened"],
  other: ["whatHappened"],
  eviction: ["city"],
  rent_increase: ["city"],
  security_deposit: ["city", "moveOutDate", "itemizedStatement", "amountWithheld"],
};

export const CITY_COUNTY: Record<string, string> = {
  "Los Angeles": "Los Angeles",
  "Santa Monica": "Los Angeles",
};

export function countyFor(city: string): string | undefined {
  return CITY_COUNTY[city];
}

export function classifyIssue(text: string): Category {
  if (/evict|lockout|locked me out|changed the locks|notice to quit|3-day notice|three-day notice/i.test(text)) {
    return "eviction";
  }
  if (/rent (increase|raised)|raised my rent|raised the rent/i.test(text)) return "rent_increase";
  if (/deposit/i.test(text)) return "security_deposit";
  if (text.trim()) return "other";
  return "unknown";
}

export function missingRequirements(category: Category, facts: FactSnapshot): Requirement[] {
  return REQUIRED[category].filter((field) => {
    if (field === "whatHappened") return category === "unknown" || category === "other";
    if (field === "city") return facts.unincorporated !== true && (facts.city == null || facts.city === "");
    return facts[field] == null || facts[field] === "";
  });
}

export function questionFor(field: Requirement): string {
  switch (field) {
    case "whatHappened":
      return "What happened with your landlord? A deposit they kept, an eviction notice, or a rent increase each lead somewhere different.";
    case "city":
      return "Which city is the apartment in? If it's outside any city, in Los Angeles County, just say that.";
    case "moveOutDate":
      return "What day did you move out?";
    case "itemizedStatement":
      return "Did they send a written list of what they kept from the deposit, and why?";
    case "amountWithheld":
      return "How much of the deposit are they still holding?";
    case "noticeDate":
      return "What date is on the notice?";
  }
}
