import { authorizeSos } from "./auth";
import {
  incidentRecordSchema,
  sosRequestSchema,
  type IncidentRecord,
  type SosRequest,
} from "./contracts";
import { enqueueInitialEnrichment } from "./enrichment";
import { HttpError } from "./errors";
import { createRawIncident } from "./incidents";
import { jsonResponse, readJsonBody } from "./http";
import { recordMetric } from "./metrics";

function canonicalSos(sos: SosRequest): string {
  return JSON.stringify({
    idempotencyKey: sos.idempotencyKey,
    jurisdictionId: sos.jurisdictionId,
    channel: sos.channel,
    text: sos.text,
    language: sos.language,
    location: sos.location,
    callerTimestamp: sos.callerTimestamp,
    accessibilityInformation: sos.accessibilityInformation,
    evidenceReferences: sos.evidenceReferences,
  });
}

async function requestHash(sos: SosRequest): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalSos(sos)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function intakeResponse(incident: IncidentRecord, deduplicated: boolean): Response {
  return jsonResponse(
    {
      incidentId: incident.id,
      incident,
      deduplicated,
      triageStatus: incident.triageStatus,
      geoStatus: incident.geoStatus,
    },
    deduplicated ? 200 : 202,
  );
}

async function waitForConcurrentIngest(
  hub: DurableObjectStub<import("./jurisdiction-hub").JurisdictionHub>,
  sos: SosRequest,
  hash: string,
): Promise<IncidentRecord | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const incidentJson = await hub.getSosResultJson(sos.jurisdictionId, sos.idempotencyKey, hash);
    if (incidentJson) return incidentRecordSchema.parse(JSON.parse(incidentJson));
  }
  return null;
}

export async function handleSos(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  const sos = sosRequestSchema.parse(await readJsonBody(request));
  await authorizeSos(request, sos, env);
  recordMetric(env.METRICS, "sos.requests_received", {
    jurisdictionId: sos.jurisdictionId,
    pipeline: "ingest",
  });

  const hash = await requestHash(sos);
  const hub = env.JURISDICTION_HUB.getByName(sos.jurisdictionId);
  const reservation = await hub.reserveSos(sos.jurisdictionId, sos.idempotencyKey, hash);
  if (reservation.status === "conflict") {
    throw new HttpError(
      409,
      "idempotency_conflict",
      "The idempotency key was already used for different SOS content",
    );
  }
  if (reservation.status === "complete") {
    return intakeResponse(incidentRecordSchema.parse(JSON.parse(reservation.incidentJson)), true);
  }
  if (reservation.status === "pending") {
    const incident = await waitForConcurrentIngest(hub, sos, hash);
    if (incident) return intakeResponse(incident, true);
    return jsonResponse({ status: "processing", idempotencyKey: sos.idempotencyKey }, 202, {
      "Retry-After": "1",
    });
  }

  let rawIncident: IncidentRecord;
  try {
    rawIncident = await createRawIncident(env, sos);
  } catch (error) {
    await hub.markSosAttemptFailed(sos.jurisdictionId, sos.idempotencyKey, hash);
    throw error;
  }

  const completed = await hub.completeSos(
    sos.jurisdictionId,
    sos.idempotencyKey,
    hash,
    JSON.stringify(rawIncident),
  );
  const completedIncident = incidentRecordSchema.parse(JSON.parse(completed.incidentJson));
  recordMetric(env.METRICS, "incident.creation_latency_ms", {
    jurisdictionId: sos.jurisdictionId,
    value: Date.now() - startedAt,
    pipeline: "ingest",
  });

  try {
    await enqueueInitialEnrichment(env, completedIncident, sos);
  } catch {
    await hub.publishSystemDegraded(sos.jurisdictionId, "queue");
  }
  return intakeResponse(completedIncident, completed.deduplicated);
}
