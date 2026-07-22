import { z } from "zod";
import { dispatchDraftSchema } from "../src/lib/schemas";
import { authorizeOperator } from "./auth";
import type { StoreMutationResult } from "./incidentStore";
import { jsonResponse, readJsonBody } from "./http";
import { readAudit } from "./audit";
import { generateBriefing } from "./briefing";

const versionRequestSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const dispatchRequestSchema = versionRequestSchema
  .extend({ incident: dispatchDraftSchema })
  .strict();
const actionRequestSchema = versionRequestSchema
  .extend({
    action: z.enum(["REQUEST_CLARIFICATION", "ESCALATE", "MARK_DUPLICATE", "RETRY_DISPATCH"]),
  })
  .strict();

async function mutationResponse(
  env: Env,
  jurisdictionId: string,
  expectedVersion: number,
  result: StoreMutationResult,
): Promise<Response> {
  if (!result.ok) {
    return jsonResponse(
      { message: result.message, currentVersion: result.currentVersion },
      result.code,
    );
  }

  const incident = JSON.parse(result.incidentJson) as { id: string };
  try {
    await env.JURISDICTION_HUB.getByName(jurisdictionId).publishIncidentUpdate(
      jurisdictionId,
      expectedVersion,
      result.incidentJson,
      result.patchJson,
    );
  } catch {
    await env.JURISDICTION_HUB.getByName(jurisdictionId).publishSystemDegraded(
      jurisdictionId,
      "incident-service",
    );
  }
  return jsonResponse(incident);
}

export async function handleIncidentApi(request: Request, env: Env): Promise<Response> {
  await authorizeOperator(request, env);
  const url = new URL(request.url);
  const jurisdictionId = env.JURISDICTION_ID;
  const store = env.INCIDENT_STORE.getByName(jurisdictionId);

  if (request.method === "GET" && url.pathname === "/incidents") {
    return jsonResponse(JSON.parse(await store.listIncidentJson(jurisdictionId)));
  }

  const match = url.pathname.match(/^\/incidents\/([^/]+)(?:\/(claim|dispatch|actions|audit|briefing))?$/);
  if (!match?.[1]) return jsonResponse({ message: "Not found" }, 404);
  const incidentId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "GET" && !action) {
    const incidentJson = await store.getIncidentJson(jurisdictionId, incidentId);
    return incidentJson
      ? jsonResponse(JSON.parse(incidentJson))
      : jsonResponse({ message: "Incident not found" }, 404);
  }
  if (request.method === "GET" && action === "audit") {
    return jsonResponse(await readAudit(env.AUDIT_DB, incidentId));
  }
  if (request.method === "GET" && action === "briefing") {
    const incidentJson = await store.getIncidentJson(jurisdictionId, incidentId);
    if (!incidentJson) return jsonResponse({ message: "Incident not found" }, 404);
    return jsonResponse(await generateBriefing(env, incidentId, JSON.parse(incidentJson)));
  }
  if (request.method !== "POST" || !action) return jsonResponse({ message: "Not found" }, 404);

  if (action === "claim") {
    const body = versionRequestSchema.parse(await readJsonBody(request));
    return mutationResponse(
      env,
      jurisdictionId,
      body.expectedVersion,
      await store.claim(jurisdictionId, incidentId, body.expectedVersion, env.OPERATOR_NAME),
    );
  }
  if (action === "dispatch") {
    const body = dispatchRequestSchema.parse(await readJsonBody(request));
    return mutationResponse(
      env,
      jurisdictionId,
      body.expectedVersion,
      await store.dispatch(
        jurisdictionId,
        incidentId,
        body.expectedVersion,
        env.OPERATOR_NAME,
        body.incident,
      ),
    );
  }

  const body = actionRequestSchema.parse(await readJsonBody(request));
  return mutationResponse(
    env,
    jurisdictionId,
    body.expectedVersion,
    await store.performAction(
      jurisdictionId,
      incidentId,
      body.expectedVersion,
      env.OPERATOR_NAME,
      body.action,
    ),
  );
}
