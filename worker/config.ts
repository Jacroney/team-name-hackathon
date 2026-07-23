import { z } from "zod";
import type { HubPrincipal } from "./contracts";

const heartbeatConfigSchema = z
  .object({
    heartbeatSeconds: z.number().int().min(5).max(60),
    staleAfterSeconds: z.number().int().min(10).max(300),
    offlineAfterSeconds: z.number().int().min(15).max(600),
    sweepEverySeconds: z.number().int().min(5).max(60),
  })
  .strict()
  .refine((value) => value.staleAfterSeconds < value.offlineAfterSeconds);

export type HeartbeatConfig = z.infer<typeof heartbeatConfigSchema>;

const priorityPolicySchema = z
  .object({
    version: z.string().min(1).max(64),
    severityScores: z
      .object({
        critical: z.number().int().min(0).max(100),
        high: z.number().int().min(0).max(100),
        medium: z.number().int().min(0).max(100),
        low: z.number().int().min(0).max(100),
        unknown: z.number().int().min(0).max(100),
      })
      .strict(),
    immediateThreatScore: z.number().int().min(0).max(100),
    injuriesScore: z.number().int().min(0).max(100),
    multiplePeopleScore: z.number().int().min(0).max(100),
    accessibilityScore: z.number().int().min(0).max(100),
    hazardZoneScore: z.number().int().min(0).max(100),
    evacuationZoneScore: z.number().int().min(0).max(100),
    blockedRoadScore: z.number().int().min(0).max(100),
    criticalThreshold: z.number().int().min(1).max(100),
    urgentThreshold: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((value) => value.urgentThreshold < value.criticalThreshold);

export type PriorityPolicy = z.infer<typeof priorityPolicySchema>;

const triageConfigSchema = z
  .object({
    promptVersion: z.string().min(1).max(64),
    model: z.string().min(1).max(200),
    priorityPolicyVersion: z.string().min(1).max(64),
  })
  .strict();

export type TriageConfig = z.infer<typeof triageConfigSchema>;

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  heartbeatSeconds: 10,
  staleAfterSeconds: 20,
  offlineAfterSeconds: 30,
  sweepEverySeconds: 5,
};

export const DEFAULT_PRIORITY_POLICY: PriorityPolicy = {
  version: "v1",
  severityScores: {
    critical: 70,
    high: 48,
    medium: 24,
    low: 8,
    unknown: 0,
  },
  immediateThreatScore: 25,
  injuriesScore: 12,
  multiplePeopleScore: 8,
  accessibilityScore: 5,
  hazardZoneScore: 15,
  evacuationZoneScore: 10,
  blockedRoadScore: 5,
  criticalThreshold: 85,
  urgentThreshold: 45,
};

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  promptVersion: "v1",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  priorityPolicyVersion: "v1",
};

const DEFAULT_TRIAGE_PROMPT = `Extract emergency report facts into the supplied JSON schema.
Do not rank incidents or make dispatch decisions.
Use unknown or null when facts are not present.
Every conclusion must include at least one exact supporting quote in evidence.
The only valid messageId is caller-message.
Return JSON only.`;

async function readConfig<T>(
  kv: KVNamespace,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  const stored = await kv.get(key, "json").catch(() => null);
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : fallback;
}

export async function getHeartbeatConfig(env: Env, jurisdictionId: string): Promise<HeartbeatConfig> {
  return readConfig(
    env.CONFIG,
    `jurisdiction:${jurisdictionId}:heartbeat`,
    heartbeatConfigSchema,
    DEFAULT_HEARTBEAT_CONFIG,
  );
}

export async function getPriorityPolicy(
  env: Env,
  jurisdictionId: string,
  requestedVersion: string,
): Promise<PriorityPolicy> {
  const versioned = await readConfig(
    env.CONFIG,
    `jurisdiction:${jurisdictionId}:priority-policy:${requestedVersion}`,
    priorityPolicySchema,
    DEFAULT_PRIORITY_POLICY,
  );
  return versioned.version === requestedVersion ? versioned : DEFAULT_PRIORITY_POLICY;
}

export async function getTriagePrompt(env: Env, version: string): Promise<string> {
  const prompt = await env.CONFIG.get(`triage-prompt:${version}`).catch(() => null);
  return prompt && prompt.length <= 8_000 ? prompt : DEFAULT_TRIAGE_PROMPT;
}

// Flagship bindings are `remote: true` and absent in local dev; these helpers
// fall back to the provided default instead of throwing on a missing binding.
async function flagString(
  env: Env,
  key: string,
  fallback: string,
  context: Record<string, string | number | boolean>,
): Promise<string> {
  if (!env.FLAGS) return fallback;
  try {
    return await env.FLAGS.getStringValue(key, fallback, context);
  } catch {
    return fallback;
  }
}

async function flagBoolean(
  env: Env,
  key: string,
  fallback: boolean,
  context: Record<string, string | number | boolean>,
): Promise<boolean> {
  if (!env.FLAGS) return fallback;
  try {
    return await env.FLAGS.getBooleanValue(key, fallback, context);
  } catch {
    return fallback;
  }
}

export async function getTriageConfig(
  env: Env,
  jurisdictionId: string,
  principal?: Pick<HubPrincipal, "sub" | "role">,
): Promise<TriageConfig> {
  const stored = await readConfig(
    env.CONFIG,
    `jurisdiction:${jurisdictionId}:triage`,
    triageConfigSchema,
    DEFAULT_TRIAGE_CONFIG,
  );
  const context = {
    jurisdictionId,
    ...(principal ? { userId: principal.sub, role: principal.role } : {}),
  };

  const [model, promptVersion, priorityPolicyVersion] = await Promise.all([
    flagString(env, "triage-model", stored.model, context),
    flagString(env, "triage-prompt-version", stored.promptVersion, context),
    flagString(env, "priority-policy-version", stored.priorityPolicyVersion, context),
  ]);

  return triageConfigSchema.parse({ model, promptVersion, priorityPolicyVersion });
}

export async function isGeoAnalysisEnabled(env: Env, jurisdictionId: string): Promise<boolean> {
  return flagBoolean(env, "geo-analysis-enabled", true, { jurisdictionId });
}

export async function isDuplicateDetectionEnabled(
  env: Env,
  jurisdictionId: string,
): Promise<boolean> {
  return flagBoolean(env, "duplicate-detection", false, { jurisdictionId });
}
