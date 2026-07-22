import { incidentRecordSchema, type IncidentPatch, type IncidentRecord, type SosRequest } from "./contracts";
import { IncidentServiceError, StaleIncidentError } from "./errors";

function parseIncidentJson(value: string): IncidentRecord {
  const parsed = incidentRecordSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new IncidentServiceError(502, false);
  return parsed.data;
}

export async function createRawIncident(env: Env, sos: SosRequest): Promise<IncidentRecord> {
  const incidentJson = await env.INCIDENT_STORE.getByName(sos.jurisdictionId).createRawIncident(
    sos.jurisdictionId,
    JSON.stringify(sos),
  );
  const incident = parseIncidentJson(incidentJson);
  if (incident.jurisdictionId !== sos.jurisdictionId) throw new IncidentServiceError(502, false);
  return incident;
}

export async function getIncident(
  env: Env,
  jurisdictionId: string,
  incidentId: string,
): Promise<IncidentRecord> {
  const incidentJson = await env.INCIDENT_STORE.getByName(jurisdictionId).getIncidentJson(
    jurisdictionId,
    incidentId,
  );
  if (!incidentJson) throw new IncidentServiceError(404, false);
  return parseIncidentJson(incidentJson);
}

interface PatchIncidentOptions {
  env: Env;
  incidentId: string;
  jurisdictionId: string;
  expectedVersion: number;
  patch: IncidentPatch;
  source: "ai-triage" | "geo-analysis" | "enrichment-failure" | "manual-retriage";
}

export async function patchIncident({
  env,
  incidentId,
  jurisdictionId,
  expectedVersion,
  patch,
  source,
}: PatchIncidentOptions): Promise<IncidentRecord> {
  const result = await env.INCIDENT_STORE.getByName(jurisdictionId).patchIncident(
    jurisdictionId,
    incidentId,
    expectedVersion,
    JSON.stringify({ ...patch, updateSource: source }),
  );
  if (!result.ok) {
    if (result.code === 409 || result.code === 412) throw new StaleIncidentError(result.currentVersion);
    throw new IncidentServiceError(result.code, result.code >= 500 || result.code === 429);
  }
  const incident = parseIncidentJson(result.incidentJson);
  if (
    incident.id !== incidentId ||
    incident.jurisdictionId !== jurisdictionId ||
    incident.version !== expectedVersion + 1
  ) {
    throw new IncidentServiceError(502, false);
  }
  return incident;
}
