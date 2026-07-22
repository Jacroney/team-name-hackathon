import { z } from "zod";
import { authorizeOperator } from "./auth";
import { incidentSchema } from "../src/lib/schemas";
import { HttpError } from "./errors";
import { getIncident, patchIncident } from "./incidents";
import { jsonResponse, readJsonBody } from "./http";
import { recordIncidentChange } from "./projection";

const videoRequestSchema = z.object({
  incidentId: z.string().min(1).max(128),
  maxDurationSeconds: z.number().int().min(1).max(3_600).default(600),
}).strict();

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export async function handleVideoUpload(request: Request, env: Env): Promise<Response> {
  await authorizeOperator(request, env);
  const body = videoRequestSchema.parse(await readJsonBody(request));
  const upload = await env.STREAM.createDirectUpload({
    maxDurationSeconds: body.maxDurationSeconds,
    creator: body.incidentId,
    requireSignedURLs: true,
    expiry: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
  });
  return jsonResponse(upload, 201);
}

export async function handleImageUpload(request: Request, env: Env): Promise<Response> {
  await authorizeOperator(request, env);
  if (!request.body) throw new HttpError(400, "body_required", "Image body is required");
  const image = await env.IMAGES.hosted.upload(request.body, {
    filename: request.headers.get("X-Filename") ?? "evidence-image",
    requireSignedURLs: true,
  });
  return jsonResponse(image, 201);
}

export async function handleEvidenceUpload(request: Request, env: Env, incidentId: string): Promise<Response> {
  await authorizeOperator(request, env);
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > MAX_EVIDENCE_BYTES) {
    throw new HttpError(413, "evidence_too_large", "Evidence must be at most 10 MB");
  }
  if (!request.body) throw new HttpError(400, "body_required", "Evidence body is required");

  const jurisdictionId = env.JURISDICTION_ID;
  const current = incidentSchema.parse(await getIncident(env, jurisdictionId, incidentId));
  const type = request.headers.get("X-Evidence-Type");
  if (type !== "PHOTO" && type !== "AUDIO" && type !== "VIDEO" && type !== "DOCUMENT") {
    throw new HttpError(400, "invalid_evidence_type", "X-Evidence-Type is required");
  }
  const evidenceId = crypto.randomUUID();
  const key = `${jurisdictionId}/${incidentId}/${evidenceId}`;
  const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
  await env.EVIDENCE.put(key, request.body, { httpMetadata: { contentType } });
  const evidence = {
    id: evidenceId,
    type,
    label: request.headers.get("X-Filename") ?? `${type.toLowerCase()} evidence`,
    timestamp: new Date().toISOString(),
    url: new URL(`/api/evidence/${key}`, request.url).toString(),
  } as const;
  try {
    const updated = await patchIncident({
      env,
      incidentId,
      jurisdictionId,
      expectedVersion: current.version,
      patch: { evidence: [...current.evidence, evidence] },
      source: "manual-evidence",
    });
    await env.JURISDICTION_HUB.getByName(jurisdictionId).publishIncidentUpdate(
      jurisdictionId,
      current.version,
      JSON.stringify(updated),
      JSON.stringify({ evidence: updated.evidence }),
    );
    await recordIncidentChange(env, updated, "evidence.uploaded");
    return jsonResponse(evidence, 201);
  } catch (error) {
    await env.EVIDENCE.delete(key);
    throw error;
  }
}

export async function handleEvidenceRead(request: Request, env: Env, key: string): Promise<Response> {
  await authorizeOperator(request, env);
  const object = await env.EVIDENCE.get(key);
  if (!object) throw new HttpError(404, "evidence_not_found", "Evidence not found");
  return new Response(object.body, { headers: object.httpMetadata?.contentType ? { "Content-Type": object.httpMetadata.contentType } : undefined });
}
