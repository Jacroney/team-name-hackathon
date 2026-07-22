import { z } from "zod";
import { authenticateHubConnection, authorizeOperator } from "./auth";
import {
  geospatialAssessmentSchema,
  jurisdictionIdSchema,
  sosLocationSchema,
  triageQueueMessageSchema,
  type IncidentPatch,
  type TriageQueueMessage,
} from "./contracts";
import { getTriageConfig } from "./config";
import { handleEnrichmentQueue } from "./enrichment";
import { HttpError, IncidentServiceError } from "./errors";
import { HazardAnalysisContainer } from "./geo-container";
import { getIncident, patchIncident, proxyIncidentRequest } from "./incidents";
import { handleSos } from "./ingest";
import { jsonResponse, readJsonBody } from "./http";
import { JurisdictionHub } from "./jurisdiction-hub";

export { HazardAnalysisContainer, JurisdictionHub };

const retriageRequestSchema = z
  .object({
    jurisdictionId: jurisdictionIdSchema,
    expectedVersion: z.number().int().positive(),
    text: z.string().trim().min(1).max(8_000),
    language: z.string().trim().min(2).max(35).optional(),
    accessibilityInformation: z.array(z.string().trim().min(1).max(256)).max(20).default([]),
    evidenceReferences: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            type: z.enum(["PHOTO", "AUDIO", "VIDEO", "DOCUMENT"]).optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  return allowed.includes(origin) ? origin : null;
}

function withCors(response: Response, request: Request, env: Env): Response {
  if (response.status === 101) return response;
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function preflight(request: Request, env: Env): Response {
  if (!allowedOrigin(request, env)) return new Response(null, { status: 403 });
  return withCors(new Response(null, { status: 204 }), request, env);
}

async function handleRealtime(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "websocket_upgrade_required", "Expected a WebSocket upgrade");
  }
  const offeredProtocols = request.headers
    .get("Sec-WebSocket-Protocol")
    ?.split(",")
    .map((value) => value.trim());
  if (!offeredProtocols?.includes("crisis-mesh")) {
    throw new HttpError(400, "websocket_protocol_required", "The crisis-mesh protocol is required");
  }

  const principal = await authenticateHubConnection(request, env);
  const url = new URL(request.url);
  const jurisdictionId = url.searchParams.get("jurisdictionId") ?? url.searchParams.get("jurisdiction");
  if (!jurisdictionId || principal.jurisdictionId !== jurisdictionId) {
    throw new HttpError(403, "jurisdiction_forbidden", "Realtime jurisdiction access denied");
  }
  jurisdictionIdSchema.parse(jurisdictionId);

  const headers = new Headers(request.headers);
  headers.set("X-CM-Jurisdiction", jurisdictionId);
  headers.set("X-CM-Principal", principal.sub);
  headers.set("X-CM-Role", principal.role);
  headers.set("Sec-WebSocket-Protocol", "crisis-mesh");
  headers.delete("Authorization");
  const internalRequest = new Request(request.url, { method: "GET", headers });
  return env.JURISDICTION_HUB.getByName(jurisdictionId).fetch(internalRequest);
}

async function handleRetriage(request: Request, env: Env, incidentId: string): Promise<Response> {
  await authorizeOperator(request, env);
  const body = retriageRequestSchema.parse(await readJsonBody(request));
  const current = await getIncident(env, incidentId);
  if (current.jurisdictionId !== body.jurisdictionId) {
    throw new HttpError(404, "incident_not_found", "Incident not found");
  }
  if (current.version !== body.expectedVersion) {
    return jsonResponse({ code: "version_conflict", currentVersion: current.version }, 409);
  }

  const patch: IncidentPatch = {
    triageStatus: "pending",
    triageFailure: null,
    retriageRequestedAt: new Date().toISOString(),
  };
  const incident = await patchIncident({
    env,
    incidentId,
    jurisdictionId: body.jurisdictionId,
    expectedVersion: body.expectedVersion,
    patch,
    source: "manual-retriage",
  });
  const published = await env.JURISDICTION_HUB.getByName(body.jurisdictionId).publishIncidentUpdate(
    body.jurisdictionId,
    body.expectedVersion,
    JSON.stringify(incident),
    JSON.stringify(patch),
  );
  if (published.status === "stale") {
    throw new HttpError(409, "version_conflict", "Incident changed before retriage could start");
  }

  const config = await getTriageConfig(env, body.jurisdictionId);
  const assessment = geospatialAssessmentSchema.safeParse(current.geospatialAssessment);
  const location = sosLocationSchema.safeParse(current.location);
  const message: TriageQueueMessage = triageQueueMessageSchema.parse({
    kind: "ai.triage",
    schemaVersion: 1,
    incidentId,
    jurisdictionId: body.jurisdictionId,
    incidentVersion: incident.version,
    receivedAt: incident.receivedAt,
    location: location.success ? location.data : null,
    triageInput: {
      text: body.text,
      language: body.language,
      accessibilityInformation: body.accessibilityInformation,
      evidenceReferences: body.evidenceReferences,
    },
    geospatialAssessment: assessment.success ? assessment.data : null,
    promptVersion: config.promptVersion,
    model: config.model,
    priorityPolicyVersion: config.priorityPolicyVersion,
    enqueuedAt: new Date().toISOString(),
  });
  await env.TRIAGE_QUEUE.send(message, { contentType: "json" });
  return jsonResponse({ incidentId, version: incident.version, triageStatus: "pending" }, 202);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return preflight(request, env);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ status: "ok" });
  }
  if (request.method === "POST" && url.pathname === "/sos") return handleSos(request, env);
  if (request.method === "GET" && url.pathname === "/realtime") return handleRealtime(request, env);

  const retriageMatch = url.pathname.match(/^\/incidents\/([^/]+)\/retriage$/);
  if (request.method === "POST" && retriageMatch?.[1]) {
    return handleRetriage(request, env, decodeURIComponent(retriageMatch[1]));
  }
  if (url.pathname === "/incidents" || url.pathname.startsWith("/incidents/")) {
    return proxyIncidentRequest(request, env);
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/sos" || url.pathname === "/realtime") {
    throw new HttpError(404, "not_found", "Route not found");
  }
  return env.ASSETS.fetch(request);
}

function errorResponse(error: unknown, request: Request): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof IncidentServiceError) {
    return jsonResponse(
      { code: "incident_service_unavailable", message: "Incident service request failed" },
      error.status >= 400 && error.status < 600 ? error.status : 502,
    );
  }
  if (error instanceof z.ZodError) {
    return jsonResponse({ code: "validation_failed", message: "Request validation failed" }, 400);
  }

  console.error(
    JSON.stringify({
      message: "request failed",
      path: new URL(request.url).pathname,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  return jsonResponse({ code: "internal_error", message: "Internal server error" }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withCors(await route(request, env), request, env);
    } catch (error) {
      return withCors(errorResponse(error, request), request, env);
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await handleEnrichmentQueue(batch, env);
  },
} satisfies ExportedHandler<Env, unknown>;
