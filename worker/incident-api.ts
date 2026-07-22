import { z } from "zod";
import { dispatchDraftSchema } from "../src/lib/schemas";
import { incidentRecordSchema } from "./contracts";
import { authorizeOperator } from "./auth";
import type { StoreMutationResult } from "./incidentStore";
import { jsonResponse, readJsonBody } from "./http";
import { recordIncidentChange } from "./projection";

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

  const incident = incidentRecordSchema.parse(JSON.parse(result.incidentJson));
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
  await recordIncidentChange(env, incident, "incident.updated");
  return jsonResponse(incident);
}

export async function handleIncidentApi(request: Request, env: Env): Promise<Response> {
  const operator = await authorizeOperator(request, env);
  const url = new URL(request.url);
  const jurisdictionId = env.JURISDICTION_ID;
  const store = env.INCIDENT_STORE.getByName(jurisdictionId);

  const path = url.pathname.replace(/^\/api/, "");
  if (request.method === "GET" && path === "/incidents") {
    return jsonResponse(JSON.parse(await store.listIncidentJson(jurisdictionId)));
  }

  const match = path.match(/^\/incidents\/([^/]+)(?:\/(claim|dispatch|actions))?$/);
  if (!match?.[1]) return jsonResponse({ message: "Not found" }, 404);
  const incidentId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "GET" && !action) {
    const incidentJson = await store.getIncidentJson(jurisdictionId, incidentId);
    return incidentJson
      ? jsonResponse(JSON.parse(incidentJson))
      : jsonResponse({ message: "Incident not found" }, 404);
  }
  if (request.method !== "POST" || !action) return jsonResponse({ message: "Not found" }, 404);

  if (action === "claim") {
    const body = versionRequestSchema.parse(await readJsonBody(request));
    return mutationResponse(
      env,
      jurisdictionId,
      body.expectedVersion,
      await store.claim(jurisdictionId, incidentId, body.expectedVersion, operator.name),
    );
  }
  if (action === "dispatch") {
    const body = dispatchRequestSchema.parse(await readJsonBody(request));
    const result = await store.dispatch(
      jurisdictionId,
      incidentId,
      body.expectedVersion,
      operator.name,
      body.incident,
    );
    if (result.ok) {
      try {
        await env.DISPATCH_WORKFLOW.create({
          id: `dispatch-${incidentId}-${body.expectedVersion}`,
          params: {
            incidentId,
            jurisdictionId,
            operator: operator.name,
            destinationAgency: body.incident.destinationAgency,
            requestedResponse: body.incident.requestedResponse,
          },
        });
      } catch {
        await env.JURISDICTION_HUB.getByName(jurisdictionId).publishIncidentUpdate(
          jurisdictionId,
          body.expectedVersion,
          result.incidentJson,
          result.patchJson,
        );
        const compensation = await store.cancelDispatch(jurisdictionId, incidentId, operator.name);
        if (compensation.ok) {
          await env.JURISDICTION_HUB.getByName(jurisdictionId).publishIncidentUpdate(
            jurisdictionId,
            body.expectedVersion + 1,
            compensation.incidentJson,
            compensation.patchJson,
          );
        }
        return jsonResponse({ message: "Dispatch workflow could not start. Retry dispatch." }, 503);
      }
    }
    return mutationResponse(
      env,
      jurisdictionId,
      body.expectedVersion,
      result,
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
      operator.name,
      body.action,
    ),
  );
}
