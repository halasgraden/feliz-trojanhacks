import { DISCLAIMER, sourceById } from "./knowledge.mjs";

const QUESTIONS = {
  whatHappened: "What happened with the landlord? A security deposit, an eviction notice, and a rent increase lead to different next steps.",
  city: "Which city is the rental property in?",
  moveOutDate: "What date did you move out and return possession of the unit?",
  itemizedStatement: "Did the landlord give you a written itemized list of deductions?",
  amounts: "How much was the full security deposit, and how much of it is still being held?",
  notice: "What is the date on the notice, and do you have a court date?",
  safety: "Are you locked out or without water, power, or gas right now?",
};

export function explainCase(record, sources, today) {
  const followUps = chooseQuestions(record).slice(0, 2);
  const missing = followUps.map((item) => item.id);

  if (record.urgency.level === "urgent") {
    return urgentAnswer(record, followUps, missing);
  }

  if (record.category !== "security_deposit") {
    return outOfScopeAnswer(record, followUps, missing);
  }

  if (record.jurisdiction.confidence === "out_of_scope" || !record.jurisdiction.state) {
    return {
      claims: [],
      calculations: [],
      nextSteps: [],
      followUps,
      missing,
      reply: renderReply({
        understood: understood(record),
        urgency: record.urgency,
        jurisdiction: record.jurisdiction,
        claims: [],
        calculations: [],
        nextSteps: [
          {
            kind: "question",
            text: "I need the property's city before I apply any housing rules.",
          },
        ],
        resources: record.resources,
        followUps,
        extra: record.jurisdiction.scopeNote,
      }),
    };
  }

  const claims = [];
  const calculations = [];
  const nextSteps = [];

  const deadline = sourceById("ca-courts-deposit-return");
  const deductions = sourceById("ca-courts-deposit-deductions");
  const remedies = sourceById("ca-courts-deposit-remedies");
  const receipts = sources.find((source) => source.id === "ca-courts-deposit-receipts");

  if (deadline && sources.some((source) => source.id === deadline.id)) {
    claims.push({
      text: deadline.text,
      sourceIds: [deadline.id],
    });
  }
  if (deductions && sources.some((source) => source.id === deductions.id) && record.facts.landlordExplained === false) {
    claims.push({ text: deductions.text, sourceIds: [deductions.id] });
  }
  if (receipts) claims.push({ text: receipts.text, sourceIds: [receipts.id] });

  if (record.facts.moveOutDate && deadline?.rules?.returnDeadlineDays && sources.some((source) => source.id === deadline.id)) {
    const due = addDays(record.facts.moveOutDate, deadline.rules.returnDeadlineDays);
    if (due) {
      const relation = today > due ? "after" : today === due ? "on" : "before";
      calculations.push({
        text: `Using the ${deadline.rules.returnDeadlineDays}-day period from ${deadline.id}, ${record.facts.moveOutDate} plus that period is ${due}. Today in this session is ${today}, which is ${relation} ${due}. This is calendar arithmetic from your date and that source, not a court finding.`,
        sourceIds: [deadline.id],
        deadline: due,
        today,
      });
    }
  }

  if (remedies && sources.some((source) => source.id === remedies.id) && record.facts.moveOutDate && record.facts.city) {
    claims.push({ text: remedies.text, sourceIds: [remedies.id] });
    nextSteps.push({
      kind: "action",
      text: "Write to the landlord, ask for the deposit that is still held and for an itemized statement if you do not have one, and keep a copy of what you send.",
      sourceIds: [remedies.id],
    });
    nextSteps.push({
      kind: "action",
      text: "If you cannot agree, California Courts Self-Help says a tenant can sue in small claims or civil court. A judge decides whether any additional damages apply.",
      sourceIds: [remedies.id],
    });
  }

  if (record.resources.length) {
    nextSteps.push({
      kind: "referral",
      text: "Contact a listed housing resource and bring your dates, amounts, and any letter or notice.",
      sourceIds: [],
    });
  }

  return {
    claims,
    calculations,
    nextSteps,
    followUps,
    missing,
    reply: renderReply({
      understood: understood(record),
      urgency: record.urgency,
      jurisdiction: record.jurisdiction,
      claims,
      calculations,
      nextSteps,
      resources: record.resources,
      followUps,
      extra: record.jurisdiction.assumption,
    }),
  };
}

function urgentAnswer(record, followUps, missing) {
  const nextSteps = [
    {
      kind: "referral",
      text: "Treat a lockout, utility shutoff, eviction notice, or court date as time-sensitive. Contact a local eviction or legal-aid service before spending time on a deposit letter.",
      sourceIds: [],
    },
  ];
  if (!record.jurisdiction.state) {
    nextSteps.unshift({
      kind: "question",
      text: "Say which city the property is in so the referral can be matched.",
      sourceIds: [],
    });
  }
  return {
    claims: [],
    calculations: [],
    nextSteps,
    followUps,
    missing,
    reply: renderReply({
      understood: understood(record),
      urgency: record.urgency,
      jurisdiction: record.jurisdiction,
      claims: [],
      calculations: [],
      nextSteps,
      resources: record.resources,
      followUps,
      extra: "Security-deposit rules are not the priority while an eviction, lockout, or shutoff is in progress. This knowledge base also does not contain eviction statutes.",
    }),
  };
}

function outOfScopeAnswer(record, followUps, missing) {
  const nextSteps = [
    {
      kind: "referral",
      text: "This MVP answers California security-deposit questions. I can store what you told me, but I will not state eviction or rent-increase rules that are not in the knowledge base.",
      sourceIds: [],
    },
  ];
  return {
    claims: [],
    calculations: [],
    nextSteps,
    followUps,
    missing,
    reply: renderReply({
      understood: understood(record),
      urgency: record.urgency,
      jurisdiction: record.jurisdiction,
      claims: [],
      calculations: [],
      nextSteps,
      resources: record.resources,
      followUps,
      extra: record.jurisdiction.scopeNote,
    }),
  };
}

function chooseQuestions(record) {
  const questions = [];
  const push = (id) => questions.push({ id, question: QUESTIONS[id] });

  if (record.urgency.level === "urgent") {
    if (!record.facts.lockout && !record.facts.utilityShutoff) push("safety");
    if (!record.jurisdiction.city) push("city");
    if (!record.facts.noticeMentioned) push("notice");
    return questions;
  }

  if (record.category === "unknown" || record.category === "other") {
    push("whatHappened");
    if (!record.facts.city && !record.unconfirmed.city) push("city");
    return questions;
  }

  if (record.category !== "security_deposit") {
    if (!record.facts.city && !record.unconfirmed.city) push("city");
    return questions;
  }

  if (!record.facts.city && !record.unconfirmed.city) push("city");
  if (!record.facts.moveOutDate) push("moveOutDate");
  if (!record.facts.itemizedStatement) push("itemizedStatement");
  if (record.facts.amountWithheld == null && record.facts.depositAmount == null) push("amounts");
  return questions;
}

function understood(record) {
  const bits = [`Dispute type: ${label(record.category)}.`];
  if (record.facts.amountWithheld != null) bits.push(`Amount still held: $${record.facts.amountWithheld}.`);
  if (record.facts.depositAmount != null) bits.push(`Deposit amount: $${record.facts.depositAmount}.`);
  if (record.facts.moveOutDate) bits.push(`Move-out date: ${record.facts.moveOutDate}.`);
  if (record.facts.itemizedStatement) bits.push(`Itemized statement: ${record.facts.itemizedStatement}.`);
  if (record.facts.landlordExplained === false) bits.push("The landlord has not explained the deduction.");
  return bits.join(" ");
}

function renderReply({ understood, urgency, jurisdiction, claims, calculations, nextSteps, resources, followUps, extra }) {
  const lines = [
    DISCLAIMER,
    "",
    "What I understood",
    understood,
    "",
    "Jurisdiction",
    describeJurisdiction(jurisdiction),
    "",
    "Urgency",
    urgency.level === "urgent"
      ? `Urgent. ${urgency.reasons.join(" ")}`
      : "Routine. Nothing in the conversation described a lockout, utility shutoff, eviction notice, or court date.",
  ];

  if (extra) {
    lines.push("", extra);
  }

  lines.push("", "What may apply");
  if (claims.length === 0) {
    lines.push("I do not have a sourced rule to apply to these facts yet.");
  } else {
    for (const claim of claims) lines.push(`- ${claim.text} [${claim.sourceIds.join(", ")}]`);
  }

  if (calculations.length) {
    lines.push("", "Calculated from your facts and a sourced period");
    for (const item of calculations) lines.push(`- ${item.text}`);
  }

  lines.push("", "What to do next");
  if (nextSteps.length === 0) lines.push("Answer the questions below before taking a legal step.");
  else nextSteps.forEach((step, index) => lines.push(`${index + 1}. ${step.text}`));

  lines.push("", "Where to get help");
  if (!resources.length) lines.push("No organization is matched until the city or county is known.");
  else {
    for (const resource of resources) {
      lines.push(`- ${resource.name}: ${resource.url}`);
      lines.push(`  ${resource.notes}`);
    }
  }

  if (followUps.length) {
    lines.push("", "What would change this guidance");
    for (const item of followUps) lines.push(`- ${item.question}`);
  }

  lines.push("", "Citations");
  const cited = new Set(claims.flatMap((claim) => claim.sourceIds));
  if (cited.size === 0) lines.push("None. No legal claim was made.");
  else {
    for (const id of cited) {
      const source = sourceById(id);
      if (source) lines.push(`- ${source.title}: ${source.url} (verified ${source.lastVerified})`);
    }
  }

  return lines.join("\n");
}

function describeJurisdiction(jurisdiction) {
  if (!jurisdiction.state && !jurisdiction.city) return "Not established.";
  const place = [jurisdiction.city, jurisdiction.county ? `${jurisdiction.county} County` : null, jurisdiction.state]
    .filter(Boolean)
    .join(", ");
  return `${place}. Confidence: ${jurisdiction.confidence}. ${jurisdiction.scopeNote ?? ""}`.trim();
}

function label(category) {
  if (category === "security_deposit") return "security deposit";
  if (category === "rent_increase") return "rent increase";
  if (category === "eviction") return "eviction";
  if (category === "other") return "housing issue, type not identified";
  return "not identified yet";
}

export function addDays(isoDate, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
