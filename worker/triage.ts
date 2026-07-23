import { getPriorityPolicy, getTriagePrompt } from "./config";
import {
  triageResultSchema,
  type RecommendedReviewPriority,
  type TriageQueueMessage,
  type TriageResult,
} from "./contracts";
import { calculateRecommendedReviewPriority } from "./priority";

const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low", "unknown"] },
    category: {
      type: "string",
      enum: ["flood", "fire", "medical", "structural", "utility", "evacuation", "other"],
    },
    summary: { type: "string" },
    immediateThreat: { type: "boolean" },
    peopleCount: { type: ["integer", "null"], minimum: 0 },
    injuriesReported: { type: ["boolean", "null"] },
    hazards: { type: "array", items: { type: "string" } },
    accessibilityNeeds: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          messageId: { type: "string", const: "caller-message" },
          quote: { type: "string" },
        },
        required: ["messageId", "quote"],
      },
    },
  },
  required: [
    "severity",
    "category",
    "summary",
    "immediateThreat",
    "peopleCount",
    "injuriesReported",
    "hazards",
    "accessibilityNeeds",
    "missingFields",
    "evidence",
  ],
} as const;

interface TriageOutput {
  result: TriageResult;
  recommendedReviewPriority: RecommendedReviewPriority;
}

function parseModelResult(output: Record<string, unknown>, callerText: string): TriageResult {
  const response = output.response;
  let value: unknown = response;
  if (typeof response === "string") {
    try {
      value = JSON.parse(response);
    } catch {
      throw new Error("Workers AI returned invalid JSON");
    }
  }
  const result = triageResultSchema.parse(value);
  const evidenceIsGrounded = result.evidence.every(
    (item) => item.messageId === "caller-message" && callerText.includes(item.quote),
  );
  if (!evidenceIsGrounded) throw new Error("Workers AI evidence is not grounded in the caller message");
  return result;
}

type TriageCategory = TriageResult["category"];
type TriageSeverity = TriageResult["severity"];

const CATEGORY_RULES: Array<{ category: TriageCategory; hazards: string[]; keywords: RegExp }> = [
  { category: "fire", hazards: ["fire", "smoke"], keywords: /\b(fire|smoke|flames?|burning|grease fire|wildfire)\b/i },
  { category: "medical", hazards: ["medical emergency"], keywords: /\b(breathing|collapsed?|unconscious|heart|allergic|diabetic|bleeding|seizure|cardiac|not breathing|cpr|overdose)\b/i },
  { category: "flood", hazards: ["rising water"], keywords: /\b(flood(ing)?|water rising|river|drown|submerged|basement.*water)\b/i },
  { category: "structural", hazards: ["structural collapse"], keywords: /\b(collapse[d]?|building.*(boom|down)|structure|debris|trapped under)\b/i },
  { category: "utility", hazards: ["hazardous materials"], keywords: /\b(gas (smell|leak)|power line|chemical|spill|fumes|electrical|sparking)\b/i },
  { category: "evacuation", hazards: ["evacuation required"], keywords: /\b(evacuat\w+|approaching the (ridge|homes)|shelter in place)\b/i },
];

const CRITICAL = /\b(not breathing|can'?t breathe|trapped|unconscious|collapse[d]?|drown|no medics|severe|spreading|still inside|bleeding|boom|screaming for help)\b/i;
const HIGH = /\b(fire|smoke|accident|allergic|chemical|gas|power line|flood|assault|dizzy|swelling)\b/i;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, several: 3, multiple: 3 };
const INJURY = /\b(injur\w+|bleeding|hurt|wound\w*|trapped|unconscious|not breathing|collapse[d]?|swelling|reaction)\b/i;

function heuristicTriage(message: TriageQueueMessage): TriageResult {
  const text = message.triageInput.text;
  const lower = text.toLowerCase();

  const matched = CATEGORY_RULES.find((rule) => rule.keywords.test(lower));
  const category: TriageCategory = matched?.category ?? "other";
  const hazards = matched ? [...matched.hazards] : [];

  const severity: TriageSeverity = CRITICAL.test(lower)
    ? "critical"
    : HIGH.test(lower)
      ? "high"
      : "medium";

  let peopleCount: number | null = null;
  const digit = lower.match(/\b(\d{1,3})\s+(people|persons?|victims?|cars?|vehicles?|occupants?)\b/);
  if (digit) peopleCount = Number(digit[1]);
  else {
    const word = lower.match(/\b(one|two|three|four|five|six|several|multiple)\s+(people|persons?|victims?|cars?|vehicles?|occupants?|trapped)\b/);
    if (word) peopleCount = NUMBER_WORDS[word[1]] ?? null;
  }

  const quote = text.trim().slice(0, 200);
  return triageResultSchema.parse({
    severity,
    category,
    summary: text.trim().slice(0, 240),
    immediateThreat: severity === "critical" || severity === "high",
    peopleCount,
    injuriesReported: INJURY.test(lower) ? true : null,
    hazards,
    accessibilityNeeds: message.triageInput.accessibilityInformation ?? [],
    missingFields: message.triageInput.text.length < 15 ? ["details"] : [],
    evidence: [{ messageId: "caller-message", quote: quote.length > 0 ? quote : text }],
  });
}

export async function runTriage(env: Env, message: TriageQueueMessage): Promise<TriageOutput> {
  const [systemPrompt, policy] = await Promise.all([
    getTriagePrompt(env, message.promptVersion),
    getPriorityPolicy(env, message.jurisdictionId, message.priorityPolicyVersion),
  ]);

  // Local/dev fallback: Workers AI binding is remote-only and absent in local
  // dev. Use a deterministic keyword heuristic so triage still completes.
  if (!env.AI) {
    const result = heuristicTriage(message);
    return {
      result,
      recommendedReviewPriority: calculateRecommendedReviewPriority(
        result,
        message.geospatialAssessment,
        policy,
      ),
    };
  }

  const output = await env.AI.run(
    message.model,
    {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            messageId: "caller-message",
            text: message.triageInput.text,
            language: message.triageInput.language ?? "unknown",
            reportedAccessibilityInformation: message.triageInput.accessibilityInformation,
            evidenceReferences: message.triageInput.evidenceReferences,
            geospatialAssessment: message.geospatialAssessment,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sos_triage_result",
          strict: true,
          schema: TRIAGE_JSON_SCHEMA,
        },
      },
      temperature: 0,
      max_tokens: 1_500,
    },
    {
      gateway: {
        id: env.AI_GATEWAY_ID,
        skipCache: true,
        collectLog: false,
        requestTimeoutMs: 20_000,
        retries: { maxAttempts: 2, retryDelayMs: 250, backoff: "exponential" },
        metadata: {
          incidentId: message.incidentId,
          jurisdictionId: message.jurisdictionId,
          promptVersion: message.promptVersion,
        },
      },
      tags: ["crisis-mesh", `prompt:${message.promptVersion}`],
    },
  );
  const result = parseModelResult(output, message.triageInput.text);
  return {
    result,
    recommendedReviewPriority: calculateRecommendedReviewPriority(
      result,
      message.geospatialAssessment,
      policy,
    ),
  };
}
