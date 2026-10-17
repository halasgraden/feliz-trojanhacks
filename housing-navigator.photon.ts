/**
 * Housing dispute navigator.
 *
 * Inspected against @portel/photon 1.37.0:
 * - Public methods on this class become CLI, Beam, and MCP tools.
 * - Private methods and names starting with "_" stay internal.
 * - @stateful persists class fields under the project .data directory.
 * - The constructor string maps to HOUSING_NAVIGATOR_GEMINI_API_KEY.
 * - Photon ships OpenAI-compatible and Anthropic adapters, not Gemini JSON
 *   schema. Language calls go to Gemini generateContent when a key is set.
 *   Retrieval, deadlines, and citations stay in code either way.
 *
 * @stateful
 */
import { SOURCES, RESOURCES } from "./src/knowledge.mjs";
import {
  classifyHousingIssue,
  handleTurn,
  previewExtraction,
  updateCaseFacts,
} from "./src/pipeline.mjs";
import { resolveJurisdiction } from "./src/jurisdiction.mjs";
import { checkUrgency } from "./src/urgency.mjs";
import { findHousingResources, searchLegalSources } from "./src/retrieve.mjs";
import { validateAnswer } from "./src/validate.mjs";
import { runEvaluation } from "./src/evaluate.mjs";

export default class HousingNavigator {
  /**
   * Gemini API key. Leave empty to run the deterministic navigator.
   */
  constructor(private geminiApiKey: string = "") {}

  /** Model used when a Gemini key is configured. */
  protected settings = {
    /** Gemini model id */
    geminiModel: "gemini-2.5-flash",
  };

  /** Case carried across turns for this Photon instance. */
  activeCase: Record<string, unknown> | null = null;

  /**
   * Talk to the housing navigator about a renter's situation.
   * @param message What the renter said {@example My landlord kept $800 of my security deposit and won't explain why.}
   */
  async talk(params: { message: string }) {
    const result = await handleTurn(this.activeCase, params.message, this.modelOptions());
    return this.remember(result);
  }

  /**
   * Classify a housing message without saving a case.
   * @param message What the renter said {@example My landlord kept $800 of my security deposit}
   * @readOnly
   */
  classifyHousingIssue(params: { message: string }) {
    return classifyHousingIssue(params.message);
  }

  /**
   * Extract facts from one message without saving a case.
   * @param message What the renter said {@example I moved out September 1, 2026 in Los Angeles}
   * @readOnly
   */
  extractCaseFacts(params: { message: string }) {
    return previewExtraction(params.message);
  }

  /**
   * Correct one stored fact and refresh the guidance.
   * @param field Fact to replace {@example city}
   * @param value New value {@example Los Angeles}
   */
  async updateCaseFacts(params: { field: string; value: string }) {
    const result = await updateCaseFacts(this.activeCase, params.field, params.value, {
      allowGemini: false,
    });
    return this.remember(result);
  }

  /**
   * Resolve jurisdiction from the active case.
   * @readOnly
   */
  resolveJurisdiction() {
    const record = this.caseOrEmpty();
    return resolveJurisdiction(record.facts ?? {}, record.unconfirmed ?? {});
  }

  /**
   * Check whether the active conversation describes something urgent.
   * @readOnly
   */
  checkUrgency() {
    const record = this.caseOrEmpty();
    const text = (record.turns ?? [])
      .filter((turn: { role: string }) => turn.role === "user")
      .map((turn: { text: string }) => turn.text)
      .join("\n");
    return checkUrgency(text, record.facts ?? {});
  }

  /**
   * Search the curated legal sources for the active case.
   * @readOnly
   */
  searchLegalSources() {
    return searchLegalSources(this.caseOrEmpty()).map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      lastVerified: source.lastVerified,
      text: source.text,
    }));
  }

  /**
   * Find housing organizations for the active case.
   * @readOnly
   */
  findHousingResources() {
    return findHousingResources(this.caseOrEmpty()).map((resource) => ({
      id: resource.id,
      name: resource.name,
      url: resource.url,
      eligibility: resource.eligibility,
      notes: resource.notes,
    }));
  }

  /**
   * Check the active reply against the sources stored on the case.
   * @readOnly
   */
  validateAnswer() {
    const record = this.caseOrEmpty();
    const last = [...(record.turns ?? [])].reverse().find((turn: { role: string }) => turn.role === "assistant");
    return validateAnswer(
      {
        claims: record.claims ?? [],
        nextSteps: record.nextSteps ?? [],
        reply: last?.text ?? record.summary ?? "",
        factNumbers: Object.values(record.facts ?? {}).filter((value) => typeof value === "number"),
      },
      record.sources ?? [],
    );
  }

  /**
   * Return the saved case summary.
   * @readOnly
   */
  saveCaseSummary() {
    const record = this.caseOrEmpty();
    return {
      id: record.id ?? null,
      summary: record.summary ?? "No case yet. Start with talk.",
      facts: record.facts ?? {},
      unconfirmed: record.unconfirmed ?? {},
      jurisdiction: record.jurisdiction ?? null,
      missing: record.missing ?? [],
      nextSteps: record.nextSteps ?? [],
    };
  }

  /**
   * Show the active case.
   * @readOnly
   */
  showCase() {
    return this.activeCase ?? { summary: "No case yet. Start with talk." };
  }

  /**
   * Forget the active case so the next talk starts over.
   */
  resetCase() {
    this.activeCase = null;
    return { reset: true };
  }

  /**
   * List the curated legal sources.
   * @readOnly
   * @format table
   */
  listLegalSources() {
    return SOURCES.map((source) => ({
      id: source.id,
      publisher: source.publisher,
      lastVerified: source.lastVerified,
      url: source.url,
    }));
  }

  /**
   * List the housing resource directory.
   * @readOnly
   * @format table
   */
  listHousingResources() {
    return RESOURCES.map((resource) => ({
      id: resource.id,
      name: resource.name,
      url: resource.url,
      disputes: resource.disputes.join(", "),
    }));
  }

  /**
   * Run the scenario checks. Jurisdiction, grounding, and urgency failures fail the run.
   * @readOnly
   * @format table
   */
  async evaluate() {
    const report = await runEvaluation();
    return report.checks.map((check) => ({
      scenario: check.name,
      pass: check.pass,
      detail: check.detail,
    }));
  }

  private modelOptions() {
    return {
      apiKey: this.geminiApiKey,
      model: this.settings?.geminiModel || "gemini-2.5-flash",
    };
  }

  private remember(result: { saved?: boolean; caseRecord?: Record<string, unknown> | null }) {
    if (result.saved !== false && result.caseRecord) this.activeCase = result.caseRecord;
    const published = { ...result } as Record<string, unknown>;
    delete published.caseRecord;
    return published;
  }

  private caseOrEmpty() {
    return (this.activeCase ?? {
      facts: {},
      unconfirmed: {},
      turns: [],
      claims: [],
      nextSteps: [],
      sources: [],
      category: "unknown",
      jurisdiction: { state: null, confidence: "missing" },
      urgency: { level: "routine", reasons: [] },
    }) as any;
  }
}
