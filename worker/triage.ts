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

export async function runTriage(env: Env, message: TriageQueueMessage): Promise<TriageOutput> {
  const [systemPrompt, policy] = await Promise.all([
    getTriagePrompt(env, message.promptVersion),
    getPriorityPolicy(env, message.jurisdictionId, message.priorityPolicyVersion),
  ]);
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
