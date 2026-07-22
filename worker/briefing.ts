import { readAudit } from "./audit";

/**
 * AI Incident Briefing (SITREP).
 *
 * Turns an incident record + its D1 audit trail + transcript into a concise,
 * commander-ready situation report and a single recommended next action.
 * Best-effort: any failure returns a graceful fallback rather than throwing,
 * so the console always renders something.
 */

const BRIEFING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = [
  "You are an emergency dispatch supervisor producing a SITREP for the incident commander.",
  "Be terse, factual, and operational. Never invent details not present in the input.",
  "Return ONLY valid JSON matching the provided schema.",
  "sitrep: 2-4 short sentences summarizing the situation, location, people, and hazards.",
  "recommendedAction: the single most important next action the commander should take now.",
  "confidence: LOW if key facts are missing, HIGH if the picture is clear.",
].join(" ");

const BRIEFING_SCHEMA = {
  type: "object",
  properties: {
    sitrep: { type: "string" },
    recommendedAction: { type: "string" },
    confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
  },
  required: ["sitrep", "recommendedAction", "confidence"],
  additionalProperties: false,
} as const;

export interface Briefing {
  incidentId: string;
  sitrep: string;
  recommendedAction: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  generatedAt: string;
  model: string;
  degraded?: boolean;
}

const fallback = (incidentId: string, reason: string): Briefing => ({
  incidentId,
  sitrep: `Automated briefing unavailable (${reason}). Review the incident record and audit trail manually.`,
  recommendedAction: "Manual review required.",
  confidence: "LOW",
  generatedAt: new Date().toISOString(),
  model: BRIEFING_MODEL,
  degraded: true,
});

/** Build a compact, token-efficient view of the incident for the model. */
function buildContext(incident: Record<string, unknown>, audit: unknown[]): unknown {
  const loc = (incident.location ?? {}) as Record<string, unknown>;
  const transcript = Array.isArray(incident.transcript)
    ? (incident.transcript as Array<Record<string, unknown>>).map((t) => ({
        speaker: t.speaker,
        text: t.original,
      }))
    : [];
  return {
    id: incident.id,
    category: incident.category,
    priority: incident.priority,
    status: incident.status,
    summary: incident.summary,
    address: loc.address,
    district: loc.district,
    peopleCount: incident.peopleCount,
    injuries: incident.injuries,
    hazards: incident.hazards,
    accessibilityNeeds: incident.accessibilityNeeds,
    destinationAgency: incident.destinationAgency,
    triageStatus: incident.triageStatus,
    transcript,
    // The audit trail is the differentiator: real chronology of operator actions.
    actionHistory: audit
      .slice(0, 20)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return { v: row.version, action: row.action, actor: row.actor, at: row.at };
      }),
  };
}

export async function generateBriefing(
  env: Env,
  incidentId: string,
  incident: Record<string, unknown>,
): Promise<Briefing> {
  let audit: unknown[] = [];
  try {
    audit = await readAudit(env.AUDIT_DB, incidentId);
  } catch {
    audit = [];
  }

  try {
    const output = (await env.AI.run(
      BRIEFING_MODEL,
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(buildContext(incident, audit)) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "incident_briefing", strict: true, schema: BRIEFING_SCHEMA },
        },
        temperature: 0,
        max_tokens: 400,
      },
      {
        gateway: {
          id: env.AI_GATEWAY_ID,
          skipCache: false,
          requestTimeoutMs: 15_000,
          retries: { maxAttempts: 2, retryDelayMs: 250, backoff: "exponential" },
        },
      },
    )) as { response?: unknown };

    const raw = typeof output.response === "string" ? JSON.parse(output.response) : output.response;
    const parsed = raw as { sitrep?: string; recommendedAction?: string; confidence?: string };
    if (!parsed?.sitrep || !parsed?.recommendedAction) return fallback(incidentId, "model returned no content");

    return {
      incidentId,
      sitrep: parsed.sitrep,
      recommendedAction: parsed.recommendedAction,
      confidence: (["LOW", "MEDIUM", "HIGH"].includes(parsed.confidence ?? "")
        ? parsed.confidence
        : "MEDIUM") as Briefing["confidence"],
      generatedAt: new Date().toISOString(),
      model: BRIEFING_MODEL,
    };
  } catch (error) {
    console.warn("briefing generation failed", error);
    return fallback(incidentId, "model call failed");
  }
}
