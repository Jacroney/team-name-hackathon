import {
  incidentRecordSchema,
  type IncidentPatch,
  type IncidentRecord,
  type SosRequest,
} from "./contracts";
import { IncidentServiceError, StaleIncidentError } from "./errors";

const INCIDENT_SERVICE_ORIGIN = "https://incidents.internal";

async function parseIncidentResponse(response: Response): Promise<IncidentRecord> {
  const parsed = incidentRecordSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new IncidentServiceError(502, false);
  return parsed.data;
}

async function currentVersionFromConflict(response: Response): Promise<number | undefined> {
  const body = (await response.json().catch(() => null)) as { currentVersion?: unknown } | null;
  return typeof body?.currentVersion === "number" ? body.currentVersion : undefined;
}

export async function createRawIncident(env: Env, sos: SosRequest): Promise<IncidentRecord> {
  const response = await env.INCIDENTS.fetch(`${INCIDENT_SERVICE_ORIGIN}/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": sos.idempotencyKey,
    },
    body: JSON.stringify({
      idempotencyKey: sos.idempotencyKey,
      jurisdictionId: sos.jurisdictionId,
      channel: sos.channel,
      text: sos.text,
      language: sos.language,
      location: sos.location,
      callerTimestamp: sos.callerTimestamp,
      accessibilityInformation: sos.accessibilityInformation,
      evidenceReferences: sos.evidenceReferences,
      triageStatus: "pending",
      geoStatus: "pending",
    }),
  });

  if (!response.ok) {
    throw new IncidentServiceError(response.status, response.status >= 500 || response.status === 429);
  }

  const incident = await parseIncidentResponse(response);
  if (incident.jurisdictionId !== sos.jurisdictionId) throw new IncidentServiceError(502, false);
  return incident;
}

export async function getIncident(env: Env, incidentId: string): Promise<IncidentRecord> {
  const response = await env.INCIDENTS.fetch(
    `${INCIDENT_SERVICE_ORIGIN}/incidents/${encodeURIComponent(incidentId)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new IncidentServiceError(response.status, response.status >= 500 || response.status === 429);
  }
  return parseIncidentResponse(response);
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
  const response = await env.INCIDENTS.fetch(
    `${INCIDENT_SERVICE_ORIGIN}/incidents/${encodeURIComponent(incidentId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion, jurisdictionId, patch, source }),
    },
  );

  if (response.status === 409 || response.status === 412) {
    throw new StaleIncidentError(await currentVersionFromConflict(response));
  }
  if (!response.ok) {
    throw new IncidentServiceError(response.status, response.status >= 500 || response.status === 429);
  }

  const incident = await parseIncidentResponse(response);
  if (
    incident.id !== incidentId ||
    incident.jurisdictionId !== jurisdictionId ||
    incident.version !== expectedVersion + 1
  ) {
    throw new IncidentServiceError(502, false);
  }
  return incident;
}

export async function proxyIncidentRequest(request: Request, env: Env): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const targetUrl = `${INCIDENT_SERVICE_ORIGIN}${sourceUrl.pathname}${sourceUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");
  headers.delete("X-Forwarded-For");
  return env.INCIDENTS.fetch(
    new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );
}
