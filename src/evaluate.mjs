import { handleTurn, updateCaseFacts } from "./pipeline.mjs";

export async function runEvaluation(today = "2026-10-17") {
  const options = { today, allowGemini: false, now: `${today}T12:00:00.000Z` };
  const checks = [];

  checks.push(await scenario("deposit without location asks before citing a deadline", async () => {
    const turn = await handleTurn(null, "My landlord kept $800 of my security deposit and won't explain why.", options);
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    expect(turn.case.category === "security_deposit", "category");
    expect(turn.case.facts.amountWithheld === 800, "amount");
    expect(turn.case.urgency.level === "routine", "urgency");
    expect(turn.case.followUps.some((item) => item.id === "city"), "asks for city");
    expect(turn.case.followUps.length <= 2, "question cap");
    expect(turn.case.claims.length === 0, "no legal claim yet");
    expect(!turn.reply.includes("21 days"), "does not apply the deadline yet");
    return turn;
  }));

  checks.push(await scenario("Los Angeles deposit uses the 21-day source and local help", async () => {
    let turn = await handleTurn(null, "My landlord kept $800 of my security deposit and won't explain why.", options);
    turn = await handleTurn(
      turn.caseRecord,
      "I moved out September 1, 2026. The apartment is in Los Angeles. They never sent an itemized list.",
      options,
    );
    expect(turn.case.facts.amountWithheld === 800, "keeps the amount from the first turn");
    expect(turn.case.facts.moveOutDate === "2026-09-01", "move-out date");
    expect(turn.case.facts.itemizedStatement === "no", "itemized statement");
    expect(turn.case.jurisdiction.city === "Los Angeles", "city");
    expect(turn.case.jurisdiction.state === "CA", "state");
    expect(turn.case.citations.some((item) => item.id === "ca-courts-deposit-return"), "21-day source");
    expect(turn.caseRecord.calculations[0]?.deadline === "2026-09-22", "deadline arithmetic");
    expect(turn.reply.includes("2026-09-22"), "shows the calculated date");
    expect(turn.reply.includes("after 2026-09-22"), "says today is after the calculated date");
    expect(turn.case.resources.some((item) => item.id === "la-county-dcba"), "county resource");
    expect(turn.case.resources.some((item) => item.id === "lafla"), "legal aid");
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    expect(!/you will win|broke the law|guaranteed/i.test(turn.reply), "no guaranteed outcome");
    return turn;
  }));

  checks.push(await scenario("lockout is urgent and is not answered with deposit law", async () => {
    const turn = await handleTurn(
      null,
      "The landlord changed the locks yesterday and left a 3-day notice on the door. I still have stuff inside.",
      options,
    );
    expect(turn.case.category === "eviction", "category");
    expect(turn.case.urgency.level === "urgent", "urgency");
    expect(turn.case.claims.length === 0, "no unsourced eviction law");
    expect(turn.case.resources.some((item) => item.id === "stay-housed-la"), "eviction referral");
    expect(!turn.reply.includes("21 days"), "does not lead with the deposit deadline");
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    return turn;
  }));

  checks.push(await scenario("rent increase outside the deposit sources is not invented", async () => {
    const turn = await handleTurn(
      null,
      "My landlord in Santa Monica raised my rent by $400 this month. Is that legal?",
      options,
    );
    expect(turn.case.category === "rent_increase", "category");
    expect(turn.case.jurisdiction.city === "Santa Monica", "city");
    expect(turn.case.claims.length === 0, "no invented rent rule");
    expect(/not in (this|the) knowledge base/i.test(turn.reply), "says the rule is not in the knowledge base");
    expect(turn.case.resources.some((item) => item.id === "la-county-dcba"), "county resource");
    expect(!turn.case.resources.some((item) => item.id === "la-housing-department"), "city agency is not county-wide");
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    return turn;
  }));

  checks.push(await scenario("an unclear complaint asks what happened", async () => {
    const turn = await handleTurn(null, "My landlord is being unfair.", options);
    expect(turn.case.category === "other", "category");
    expect(turn.case.followUps.some((item) => item.id === "whatHappened"), "clarifying question");
    expect(turn.case.claims.length === 0, "no legal claim");
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    return turn;
  }));

  checks.push(await scenario("a corrected city is stored and can be read back", async () => {
    let turn = await handleTurn(null, "They kept $500 of my deposit.", options);
    turn = await updateCaseFacts(turn.caseRecord, "city", "Los Angeles", options);
    turn = await updateCaseFacts(turn.caseRecord, "moveOutDate", "2026-09-01", options);
    expect(turn.case.facts.city === "Los Angeles", "corrected city");
    expect(turn.case.facts.amountWithheld === 500, "amount survived correction");
    expect(turn.case.jurisdiction.state === "CA", "state after correction");
    expect(turn.validation.ok, turn.validation.problems.join("; "));
    return turn;
  }));

  const failed = checks.filter((item) => !item.pass);
  return {
    principle: "Accuracy over answering",
    today,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
}

async function scenario(name, run) {
  try {
    const turn = await run();
    return { name, pass: true, detail: "ok", turn };
  } catch (error) {
    return { name, pass: false, detail: error.message, turn: null };
  }
}

function expect(condition, detail) {
  if (!condition) throw new Error(detail);
}
