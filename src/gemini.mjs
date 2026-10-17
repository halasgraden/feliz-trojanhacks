/**
 * Gemini is used for classification and fact extraction, and optionally to
 * rewrite a reply that code already grounded. Legal numbers stay in the
 * curated sources. Photon 1.37.0 ships OpenAI-compatible and Anthropic
 * adapters, not a Gemini JSON-schema adapter, so this calls generateContent.
 */

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: {
      type: "STRING",
      enum: ["security_deposit", "eviction", "rent_increase", "other", "unknown"],
    },
    amountWithheld: { type: "NUMBER", nullable: true },
    depositAmount: { type: "NUMBER", nullable: true },
    moveOutDate: { type: "STRING", nullable: true },
    city: { type: "STRING", nullable: true },
    itemizedStatement: { type: "STRING", enum: ["yes", "no", "unknown"], nullable: true },
  },
  required: ["category"],
};

export async function geminiExtract({ apiKey, model, message }) {
  const parsed = await geminiJson({
    apiKey,
    model,
    system:
      "You extract housing-dispute facts. Use only facts stated in the message. Do not infer a city, date, or dollar amount that is not written. Dates must be YYYY-MM-DD. If a fact is absent, omit it or use null.",
    prompt: message,
    schema: EXTRACT_SCHEMA,
  });

  const confirmed = {};
  if (typeof parsed.amountWithheld === "number" && messageIncludesNumber(message, parsed.amountWithheld)) {
    confirmed.amountWithheld = parsed.amountWithheld;
  }
  if (typeof parsed.depositAmount === "number" && messageIncludesNumber(message, parsed.depositAmount)) {
    confirmed.depositAmount = parsed.depositAmount;
  }
  if (typeof parsed.moveOutDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.moveOutDate)) {
    const [year, month, day] = parsed.moveOutDate.split("-");
    if (messageMentionsDate(message, year, month, day)) confirmed.moveOutDate = parsed.moveOutDate;
  }
  if (typeof parsed.city === "string" && message.toLowerCase().includes(parsed.city.toLowerCase())) {
    confirmed.city = parsed.city;
  }
  if (
    (parsed.itemizedStatement === "yes" || parsed.itemizedStatement === "no") &&
    /itemized/i.test(message)
  ) {
    confirmed.itemizedStatement = parsed.itemizedStatement;
  }

  const category = ["security_deposit", "eviction", "rent_increase", "other", "unknown"].includes(parsed.category)
    ? parsed.category
    : "unknown";

  return { category, confirmed };
}

export async function geminiRewrite({ apiKey, model, reply }) {
  const text = await geminiText({
    apiKey,
    model,
    system:
      "Rewrite the navigator reply in plain sentences. Do not add facts, dates, dollar amounts, deadlines, cities, or legal rules. Keep every source id that appears in brackets. If you cannot do that, return the original text unchanged.",
    prompt: reply,
  });
  return text.trim();
}

async function geminiJson({ apiKey, model, system, prompt, schema }) {
  const text = await geminiText({ apiKey, model, system, prompt, schema });
  return JSON.parse(stripFence(text));
}

async function geminiText({ apiKey, model, system, prompt, schema }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig = { temperature: 0.1 };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = schema;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Gemini request failed: ${message}`);
  }
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text.");
  return text;
}

function stripFence(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function messageIncludesNumber(message, value) {
  const raw = String(value);
  const withCommas = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return message.includes(raw) || message.includes(withCommas) || message.includes(`$${raw}`) || message.includes(`$${withCommas}`);
}

function messageMentionsDate(message, year, month, day) {
  const monthNumber = String(Number(month));
  const dayNumber = String(Number(day));
  if (message.includes(`${year}-${month}-${day}`)) return true;
  if (message.includes(`${monthNumber}/${dayNumber}/${year}`)) return true;
  const names = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const name = names[Number(month) - 1];
  const short = name.slice(0, 3);
  const lower = message.toLowerCase();
  return (
    (lower.includes(name) || lower.includes(short)) &&
    new RegExp(`\\b${dayNumber}(?:st|nd|rd|th)?\\b`).test(lower) &&
    lower.includes(year)
  );
}
