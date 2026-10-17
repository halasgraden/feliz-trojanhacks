const LA_COUNTY_CITIES = [
  "Santa Monica",
  "Pasadena",
  "Long Beach",
  "Inglewood",
  "West Hollywood",
  "Culver City",
  "Burbank",
  "Glendale",
  "Torrance",
  "Pomona",
  "Downey",
  "El Monte",
  "Lancaster",
  "Palmdale",
];

const OTHER_CA_CITIES = [
  "San Francisco",
  "Oakland",
  "San Diego",
  "Sacramento",
  "San Jose",
  "Fresno",
  "Berkeley",
  "Irvine",
  "Anaheim",
  "Santa Ana",
  "Riverside",
  "Bakersfield",
];

const OUTSIDE = [
  ["Phoenix", "AZ"],
  ["Arizona", "AZ"],
  ["Seattle", "WA"],
  ["Texas", "TX"],
  ["New York", "NY"],
  ["Chicago", "IL"],
  ["Nevada", "NV"],
  ["Las Vegas", "NV"],
];

export function parseLocation(text) {
  const empty = {
    state: null,
    county: null,
    city: null,
    confidence: "missing",
    outsideCalifornia: false,
  };
  if (!text) return empty;

  for (const [name, state] of OUTSIDE) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) {
      return { state, county: null, city: name, confidence: "confirmed", outsideCalifornia: true };
    }
  }

  for (const city of LA_COUNTY_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(text)) {
      return { state: "CA", county: "Los Angeles", city, confidence: "confirmed", outsideCalifornia: false };
    }
  }

  for (const city of OTHER_CA_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(text)) {
      return { state: "CA", county: null, city, confidence: "confirmed", outsideCalifornia: false };
    }
  }

  if (/\b(los angeles county|l\.?\s?a\.?\s+county)\b/i.test(text) && !/\bcity of los angeles\b/i.test(text)) {
    return {
      state: "CA",
      county: "Los Angeles",
      city: null,
      confidence: "confirmed",
      outsideCalifornia: false,
    };
  }

  if (/\b(city of los angeles|los angeles)\b/i.test(text)) {
    return {
      state: "CA",
      county: "Los Angeles",
      city: "Los Angeles",
      confidence: "confirmed",
      outsideCalifornia: false,
    };
  }

  if (/\bL\.A\.\b/.test(text) || /\bLA\b/.test(text)) {
    return {
      state: "CA",
      county: "Los Angeles",
      city: "Los Angeles",
      confidence: "unconfirmed",
      outsideCalifornia: false,
    };
  }

  if (/\bcalifornia\b|\bcalif\b/i.test(text)) {
    return { state: "CA", county: null, city: null, confidence: "confirmed", outsideCalifornia: false };
  }

  return empty;
}

export function resolveJurisdiction(facts = {}, unconfirmed = {}) {
  if (facts.outsideCalifornia) {
    return {
      state: facts.state ?? null,
      county: null,
      city: facts.city ?? null,
      confidence: "out_of_scope",
      assumption: null,
      scopeNote: "The property does not appear to be in California. This knowledge base only covers California security-deposit information, focused on Los Angeles.",
    };
  }

  const city = facts.city ?? unconfirmed.city ?? null;
  const county = facts.county ?? (city === "Los Angeles" ? "Los Angeles" : null);
  const state = facts.state ?? unconfirmed.state ?? (county === "Los Angeles" ? "CA" : null);
  const assumption =
    !facts.city && unconfirmed.city
      ? "I am treating this as the City of Los Angeles because the message said LA. Correct this if you mean the county or another city."
      : null;

  let confidence = "missing";
  if (facts.city && facts.state) confidence = "high";
  else if (facts.city || facts.county) confidence = "medium";
  else if (unconfirmed.city) confidence = "assumed";
  else if (state) confidence = "low";

  let scopeNote = null;
  if (state === "CA" && city && city !== "Los Angeles") {
    scopeNote = `${city} is outside the City of Los Angeles. Statewide California deposit information can still be discussed. City rules for ${city} are not in this knowledge base.`;
  } else if (state === "CA" && !city && county === "Los Angeles") {
    scopeNote = "Los Angeles County is not the same as the City of Los Angeles. City housing programs may not cover this property.";
  } else if (state === "CA" && !city) {
    scopeNote = "The city is still unknown, so city and county programs are not matched yet.";
  } else if (!state) {
    scopeNote = "Jurisdiction is not established. California rules are not applied until the property location is known.";
  }

  return {
    state: state ?? null,
    county: county ?? null,
    city,
    confidence,
    assumption,
    scopeNote,
  };
}
