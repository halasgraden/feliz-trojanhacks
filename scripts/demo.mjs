import { runEvaluation } from "../src/evaluate.mjs";
import { handleTurn } from "../src/pipeline.mjs";

const report = await runEvaluation("2026-10-17");

console.log(`\nHousing navigator evaluation — ${report.principle}`);
console.log(`Passed ${report.passed} / ${report.passed + report.failed}\n`);
for (const check of report.checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  if (!check.pass) console.log(`      ${check.detail}`);
}

const sample = report.checks.find((check) => check.name.startsWith("Los Angeles"));
if (sample?.turn) {
  console.log("\n----- Sample grounded reply -----\n");
  console.log(sample.turn.reply);
  console.log("\n----- Case summary -----\n");
  console.log(sample.turn.case.summary);
}

if (report.failed > 0) process.exit(1);

const live = await handleTurn(
  null,
  "My landlord kept $800 of my security deposit and won't explain why.",
  { allowGemini: false, today: new Date().toISOString().slice(0, 10) },
);
if (!live.reply || !live.case) {
  console.error("Live turn did not return a reply.");
  process.exit(1);
}
