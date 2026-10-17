/**
 * Loads housing-navigator.photon.ts with Photon's compiler and calls one tool.
 *
 * Photon's CLI starts a background daemon. On Windows that daemon writes its
 * owner file next to a named pipe (`\\.\pipe\daemon.owner.json`), which fails
 * in @portel/photon 1.37.0 and 1.38.0. This runner uses the same photon class
 * without that daemon. `npm run photon` still calls the real CLI.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compilePhotonTS } from "@portel/photon-core";

const root = process.cwd();
const statePath = path.join(root, ".data", "housing-navigator-session.json");
const cacheDir = path.join(root, ".data", "compile");
mkdirSync(cacheDir, { recursive: true });

const compiled = await compilePhotonTS(path.join(root, "housing-navigator.photon.ts"), { cacheDir });
const loaded = await import(pathToFileURL(compiled).href);
const Agent = loaded.default;
const agent = new Agent(process.env.HOUSING_NAVIGATOR_GEMINI_API_KEY ?? "");

if (existsSync(statePath)) {
  agent.activeCase = JSON.parse(readFileSync(statePath, "utf8")).activeCase ?? null;
}

const command = process.argv[2] ?? "help";
const message = flag("message");
const field = flag("field");
const value = flag("value");

const calls = {
  talk: () => agent.talk({ message: required(message, "message") }),
  classify: () => agent.classifyHousingIssue({ message: required(message, "message") }),
  extract: () => agent.extractCaseFacts({ message: required(message, "message") }),
  update: () => agent.updateCaseFacts({ field: required(field, "field"), value: required(value, "value") }),
  show: () => agent.showCase(),
  summary: () => agent.saveCaseSummary(),
  reset: () => agent.resetCase(),
  jurisdiction: () => agent.resolveJurisdiction(),
  urgency: () => agent.checkUrgency(),
  search: () => agent.searchLegalSources(),
  resources: () => agent.findHousingResources(),
  validate: () => agent.validateAnswer(),
  sources: () => agent.listLegalSources(),
  directory: () => agent.listHousingResources(),
  evaluate: () => agent.evaluate(),
};

if (!calls[command]) {
  console.log(`Usage: node scripts/agent.mjs <command> [--message "..."] [--field city] [--value "Los Angeles"]

Commands: talk, classify, extract, update, show, summary, reset, jurisdiction,
          urgency, search, resources, validate, sources, directory, evaluate`);
  process.exit(command === "help" ? 0 : 1);
}

const result = await calls[command]();
mkdirSync(path.dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify({ activeCase: agent.activeCase }, null, 2));

if (result?.reply) {
  console.log(result.reply);
  console.log(`\nEngine: ${result.engine}. ${result.engineNote ?? ""}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(input, name) {
  if (!input) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return input;
}
