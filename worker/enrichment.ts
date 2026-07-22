import { getTriageConfig, isGeoAnalysisEnabled } from "./config";
import {
  geoQueueMessageSchema,
  geospatialAssessmentSchema,
  triageQueueMessageSchema,
  type GeoQueueMessage,
  type GeospatialAssessment,
  type IncidentPatch,
  type IncidentRecord,
  type SosRequest,
  type TriageQueueMessage,
} from "./contracts";
import { IncidentServiceError, StaleIncidentError } from "./errors";
import { findPossibleDuplicates } from "./duplicates";
import { runGeospatialAssessment } from "./geo-container";
import { getIncident, patchIncident } from "./incidents";
import { recordMetric } from "./metrics";
import { runTriage } from "./triage";
import { recordIncidentChange } from "./projection";

function maxAttempts(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 2 && parsed <= 10 ? parsed : 4;
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(300, 2 ** Math.max(1, attempts));
}

function triageInput(sos: SosRequest): GeoQueueMessage["triageInput"] {
  return {
    text: sos.text,
    language: sos.language,
    accessibilityInformation: sos.accessibilityInformation,
    evidenceReferences: sos.evidenceReferences,
  };
}

async function publishUpdate(
  env: Env,
  jurisdictionId: string,
  expectedVersion: number,
  incident: IncidentRecord,
  patch: IncidentPatch,
  type: "incident.patch" | "incident.triage_failed" = "incident.patch",
): Promise<void> {
  const hub = env.JURISDICTION_HUB.getByName(jurisdictionId);
  const result = await hub.publishIncidentUpdate(
    jurisdictionId,
    expectedVersion,
    JSON.stringify(incident),
    JSON.stringify(patch),
    type,
  );
  if (result.status === "stale") throw new StaleIncidentError(result.currentVersion);
}

async function enqueueTriage(
  env: Env,
  source: Pick<
    GeoQueueMessage,
    "incidentId" | "jurisdictionId" | "triageInput" | "receivedAt" | "location"
  >,
  incidentVersion: number,
  assessment: GeospatialAssessment | null,
): Promise<void> {
  const config = await getTriageConfig(env, source.jurisdictionId);
  const message: TriageQueueMessage = {
    kind: "ai.triage",
    schemaVersion: 1,
    incidentId: source.incidentId,
    jurisdictionId: source.jurisdictionId,
    incidentVersion,
    receivedAt: source.receivedAt,
    location: source.location,
    triageInput: source.triageInput,
    geospatialAssessment: assessment,
    promptVersion: config.promptVersion,
    model: config.model,
    priorityPolicyVersion: config.priorityPolicyVersion,
    enqueuedAt: new Date().toISOString(),
  };
  await env.TRIAGE_QUEUE.send(message, { contentType: "json" });
}

async function markEnrichmentFailed(
  env: Env,
  incidentId: string,
  jurisdictionId: string,
  expectedVersion: number,
  pipeline: "geo" | "ai",
  code: string,
): Promise<IncidentRecord> {
  const patch: IncidentPatch =
    pipeline === "geo"
      ? {
          geoStatus: "failed",
          geoFailure: { code, failedAt: new Date().toISOString() },
        }
      : {
          triageStatus: "failed",
          triageFailure: { code, failedAt: new Date().toISOString() },
        };
  const incident = await patchIncident({
    env,
    incidentId,
    jurisdictionId,
    expectedVersion,
    patch,
    source: "enrichment-failure",
  });
  await publishUpdate(
    env,
    jurisdictionId,
    expectedVersion,
    incident,
    patch,
    pipeline === "ai" ? "incident.triage_failed" : "incident.patch",
  );
  await recordIncidentChange(env, incident, `enrichment.${pipeline}_failed`);
  return incident;
}

export async function enqueueInitialEnrichment(
  env: Env,
  incident: IncidentRecord,
  sos: SosRequest,
): Promise<void> {
  const geoEnabled = await isGeoAnalysisEnabled(env, sos.jurisdictionId);
  const message: GeoQueueMessage = {
    kind: "geo.assess",
    schemaVersion: 1,
    incidentId: incident.id,
    jurisdictionId: sos.jurisdictionId,
    incidentVersion: incident.version,
    receivedAt: incident.receivedAt,
    location: sos.location ?? null,
    skipReason: !sos.location ? "location_unavailable" : geoEnabled ? undefined : "feature_disabled",
    triageInput: triageInput(sos),
    enqueuedAt: new Date().toISOString(),
  };

  try {
    await env.GEO_QUEUE.send(message, { contentType: "json" });
  } catch {
    const failed = await markEnrichmentFailed(
      env,
      incident.id,
      sos.jurisdictionId,
      incident.version,
      "geo",
      "queue_unavailable",
    );
    try {
      await enqueueTriage(env, message, failed.version, null);
    } catch {
      await markEnrichmentFailed(
        env,
        incident.id,
        sos.jurisdictionId,
        failed.version,
        "ai",
        "queue_unavailable",
      );
    }
    await env.JURISDICTION_HUB.getByName(sos.jurisdictionId).publishSystemDegraded(
      sos.jurisdictionId,
      "queue",
    );
  }
}

async function resumeGeoPipeline(env: Env, message: GeoQueueMessage): Promise<boolean> {
  const incident = await getIncident(env, message.jurisdictionId, message.incidentId);
  if (incident.jurisdictionId !== message.jurisdictionId) throw new StaleIncidentError();
  if (incident.triageStatus !== "pending") return true;
  if (incident.version === message.incidentVersion) return false;
  if (incident.geoStatus === "complete") {
    const assessment = geospatialAssessmentSchema.safeParse(incident.geospatialAssessment);
    if (!assessment.success) throw new StaleIncidentError(incident.version);
    await enqueueTriage(env, message, incident.version, assessment.data);
    return true;
  }
  if (incident.geoStatus === "failed") {
    await enqueueTriage(env, message, incident.version, null);
    return true;
  }
  throw new StaleIncidentError(incident.version);
}

async function completeGeoAnalysis(
  env: Env,
  message: GeoQueueMessage,
  assessment: GeospatialAssessment,
): Promise<IncidentRecord> {
  const patch: IncidentPatch = {
    geoStatus: "complete",
    geospatialAssessment: assessment,
    geoCompletedAt: new Date().toISOString(),
  };
  const incident = await patchIncident({
    env,
    incidentId: message.incidentId,
    jurisdictionId: message.jurisdictionId,
    expectedVersion: message.incidentVersion,
    patch,
    source: "geo-analysis",
  });
  await publishUpdate(env, message.jurisdictionId, message.incidentVersion, incident, patch);
  await recordIncidentChange(env, incident, "enrichment.geo_complete");
  return incident;
}

async function processGeoMessage(message: Message, env: Env): Promise<void> {
  const parsed = geoQueueMessageSchema.safeParse(message.body);
  if (!parsed.success) {
    recordMetric(env.METRICS, "geo.failure", {
      jurisdictionId: "invalid",
      outcome: "invalid_message",
      pipeline: "geo",
    });
    message.ack();
    return;
  }
  const job = parsed.data;
  const startedAt = Date.now();
  try {
    if (await resumeGeoPipeline(env, job)) {
      message.ack();
      return;
    }

    if (job.skipReason || !job.location) {
      const failed = await markEnrichmentFailed(
        env,
        job.incidentId,
        job.jurisdictionId,
        job.incidentVersion,
        "geo",
        job.skipReason ?? "location_unavailable",
      );
      await enqueueTriage(env, job, failed.version, null);
      message.ack();
      return;
    }

    const assessment = await runGeospatialAssessment(env, job);
    const incident = await completeGeoAnalysis(env, job, assessment);
    await enqueueTriage(env, job, incident.version, assessment);
    recordMetric(env.METRICS, "geo.analysis_latency_ms", {
      jurisdictionId: job.jurisdictionId,
      value: Date.now() - startedAt,
      pipeline: "geo",
    });
    message.ack();
  } catch (error) {
    if (error instanceof StaleIncidentError) {
      message.ack();
      return;
    }
    try {
      if (await resumeGeoPipeline(env, job)) {
        message.ack();
        return;
      }
    } catch (resumeError) {
      if (resumeError instanceof StaleIncidentError) {
        message.ack();
        return;
      }
    }
    recordMetric(env.METRICS, "geo.failure", {
      jurisdictionId: job.jurisdictionId,
      outcome: error instanceof IncidentServiceError ? "incident_service" : "analysis",
      pipeline: "geo",
    });
    if (message.attempts < maxAttempts(env.GEO_MAX_ATTEMPTS)) {
      recordMetric(env.METRICS, "queue.retries", {
        jurisdictionId: job.jurisdictionId,
        outcome: "geo",
        pipeline: "geo",
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      return;
    }

    try {
      const failed = await markEnrichmentFailed(
        env,
        job.incidentId,
        job.jurisdictionId,
        job.incidentVersion,
        "geo",
        "retries_exhausted",
      );
      try {
        await enqueueTriage(env, job, failed.version, null);
      } catch {
        await markEnrichmentFailed(
          env,
          job.incidentId,
          job.jurisdictionId,
          failed.version,
          "ai",
          "queue_unavailable",
        );
      }
    } catch (failureError) {
      if (!(failureError instanceof StaleIncidentError)) {
        await env.JURISDICTION_HUB.getByName(job.jurisdictionId).publishSystemDegraded(
          job.jurisdictionId,
          "incident-service",
        );
      }
    }
    message.ack();
  }
}

async function processTriageMessage(message: Message, env: Env): Promise<void> {
  const parsed = triageQueueMessageSchema.safeParse(message.body);
  if (!parsed.success) {
    recordMetric(env.METRICS, "ai.failure", {
      jurisdictionId: "invalid",
      outcome: "invalid_message",
      pipeline: "ai",
    });
    message.ack();
    return;
  }
  const job = parsed.data;
  const startedAt = Date.now();
  try {
    const [output, possibleDuplicateIds] = await Promise.all([
      runTriage(env, job),
      findPossibleDuplicates(env, job),
    ]);
    const patch: IncidentPatch = {
      triageStatus: "complete",
      triage: output.result,
      recommendedReviewPriority: output.recommendedReviewPriority,
      possibleDuplicateIds,
      triageMetadata: {
        promptVersion: job.promptVersion,
        model: job.model,
        completedAt: new Date().toISOString(),
      },
    };
    const incident = await patchIncident({
      env,
      incidentId: job.incidentId,
      jurisdictionId: job.jurisdictionId,
      expectedVersion: job.incidentVersion,
      patch,
      source: "ai-triage",
    });
    await publishUpdate(env, job.jurisdictionId, job.incidentVersion, incident, patch);
    await recordIncidentChange(env, incident, "enrichment.triage_complete");
    recordMetric(env.METRICS, "ai.triage_latency_ms", {
      jurisdictionId: job.jurisdictionId,
      value: Date.now() - startedAt,
      pipeline: "ai",
    });
    message.ack();
  } catch (error) {
    if (error instanceof StaleIncidentError) {
      message.ack();
      return;
    }
    recordMetric(env.METRICS, "ai.failure", {
      jurisdictionId: job.jurisdictionId,
      outcome: error instanceof IncidentServiceError ? "incident_service" : "inference",
      pipeline: "ai",
    });
    if (message.attempts < maxAttempts(env.TRIAGE_MAX_ATTEMPTS)) {
      recordMetric(env.METRICS, "queue.retries", {
        jurisdictionId: job.jurisdictionId,
        outcome: "ai",
        pipeline: "ai",
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      return;
    }

    try {
      await markEnrichmentFailed(
        env,
        job.incidentId,
        job.jurisdictionId,
        job.incidentVersion,
        "ai",
        "retries_exhausted",
      );
    } catch (failureError) {
      if (!(failureError instanceof StaleIncidentError)) {
        await env.JURISDICTION_HUB.getByName(job.jurisdictionId).publishSystemDegraded(
          job.jurisdictionId,
          "incident-service",
        );
      }
    }
    message.ack();
  }
}

export async function handleEnrichmentQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  await Promise.allSettled(
    batch.messages.map(async (message) => {
      try {
        if (batch.queue === env.GEO_QUEUE_NAME) {
          await processGeoMessage(message, env);
        } else {
          await processTriageMessage(message, env);
        }
      } catch {
        // Guarantee exactly one terminal disposition: the per-message handlers
        // always ack/retry on their own paths. If one throws unexpectedly before
        // reaching a terminal call, retry it exactly once here.
        try {
          message.retry();
        } catch {
          // Terminal disposition was already applied; nothing more to do.
        }
      }
    }),
  );
}
