import { DurableObject } from "cloudflare:workers";
import { writeAudit } from "./audit";
import {
  incidentSchema,
  type Activity,
  type DispatchDraft,
} from "../src/lib/schemas";
import {
  incidentPatchSchema,
  incidentRecordSchema,
  jurisdictionIdSchema,
  jsonValueSchema,
  recommendedReviewPrioritySchema,
  sosLocationSchema,
  sosRequestSchema,
  triageResultSchema,
  type IncidentPatch,
  type SosRequest,
} from "./contracts";

const storedIncidentSchema = incidentSchema
  .extend({
    jurisdictionId: jurisdictionIdSchema,
    triageStatus: incidentRecordSchema.shape.triageStatus,
    geoStatus: incidentRecordSchema.shape.geoStatus,
    sourceLocation: sosLocationSchema.nullable(),
  })
  .catchall(jsonValueSchema);

type StoredIncident = ReturnType<typeof storedIncidentSchema.parse>;

export type StoreMutationResult =
  | { ok: true; incidentJson: string; patchJson: string }
  | { ok: false; code: number; message: string; currentVersion?: number };

export type IncidentAction =
  | "REQUEST_CLARIFICATION"
  | "ESCALATE"
  | "MARK_DUPLICATE"
  | "RETRY_DISPATCH";

interface IncidentRow {
  [key: string]: SqlStorageValue;
  incident_json: string;
}

type IncidentUpdate =
  | { patch: Record<string, unknown> }
  | { error: { code: number; message: string } };

const categoryMap = {
  flood: "RESCUE",
  fire: "FIRE",
  medical: "MEDICAL",
  structural: "RESCUE",
  utility: "OTHER",
  evacuation: "RESCUE",
  other: "OTHER",
} as const;

function appendActivity(
  activity: Activity[],
  actor: string,
  action: string,
  detail?: string,
): Activity[] {
  return [
    ...activity,
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actor,
      action,
      ...(detail ? { detail } : {}),
    },
  ];
}

function initialIncident(jurisdictionId: string, sos: SosRequest): StoredIncident {
  const now = new Date().toISOString();
  const channel = sos.channel === "VOICE" ? "PHONE" : sos.channel === "APP" ? "WEB" : sos.channel;
  const address = sos.location?.address ?? "Location awaiting confirmation";
  const id = `SOS-${crypto.randomUUID()}`;
  return storedIncidentSchema.parse({
    id,
    jurisdictionId,
    version: 1,
    category: "OTHER",
    priority: "UNKNOWN",
    status: "INTAKE",
    summary: sos.text.slice(0, 1_000),
    location: {
      address,
      district: jurisdictionId,
      coordinates: [sos.location?.longitude ?? 0, sos.location?.latitude ?? 0],
    },
    sourceLocation: sos.location ?? null,
    channel,
    callerConnection: "CONNECTED",
    peopleCount: null,
    injuries: "Not assessed",
    hazards: [],
    accessibilityNeeds: sos.accessibilityInformation,
    destinationAgency: "Metro Emergency Communications",
    requestedResponse: "Assess and dispatch appropriate unit",
    missingFields: [],
    claimedBy: null,
    viewers: [],
    receivedAt: now,
    updatedAt: now,
    transcript: [
      {
        id: `${id}-caller`,
        speaker: "CALLER",
        original: sos.text,
        language: sos.language,
        timestamp: sos.callerTimestamp ?? now,
        factIds: [],
      },
    ],
    evidence: sos.evidenceReferences.map((evidence) => ({
      id: evidence.id,
      type: evidence.type ?? "DOCUMENT",
      label: evidence.type ? `${evidence.type.toLowerCase()} evidence` : "Submitted evidence",
      timestamp: now,
    })),
    activity: [
      {
        id: `${id}-created`,
        timestamp: now,
        actor: "Crisis Mesh",
        action: "Incident created",
        detail: `${channel.toLowerCase()} intake opened`,
      },
    ],
    recommendation: {
      agency: "Metro Emergency Communications",
      units: ["Nearest response unit"],
      etaMinutes: 0,
      rationale: "Awaiting automated triage and operator review.",
    },
    triageStatus: "pending",
    geoStatus: "pending",
  });
}

function enrichmentFields(current: StoredIncident, patch: IncidentPatch): Record<string, unknown> {
  const triage = triageResultSchema.safeParse(patch.triage);
  const priority = recommendedReviewPrioritySchema.safeParse(patch.recommendedReviewPriority);
  const mapped: Record<string, unknown> = { ...patch };
  if (triage.success) {
    mapped.category = categoryMap[triage.data.category];
    mapped.summary = triage.data.summary;
    mapped.peopleCount = triage.data.peopleCount;
    mapped.injuries =
      triage.data.injuriesReported === null
        ? current.injuries
        : triage.data.injuriesReported
          ? "Injuries reported"
          : "No injuries reported";
    mapped.hazards = triage.data.hazards;
    mapped.accessibilityNeeds = triage.data.accessibilityNeeds;
    mapped.missingFields = triage.data.missingFields;
    if (!["CLAIMED", "DISPATCHED", "CLOSED"].includes(current.status)) {
      mapped.status = "NEEDS_REVIEW";
    }
    mapped.activity = appendActivity(current.activity, "Triage AI", "Initial extraction complete");
  }
  if (priority.success) mapped.priority = priority.data.level;
  if (patch.triageStatus === "failed") {
    if (current.status === "INTAKE") mapped.status = "NEEDS_REVIEW";
    mapped.failureReason = "Automated triage failed; manual review is required.";
  }
  return mapped;
}

export class IncidentStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS incidents (
          incident_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL,
          received_at_ms INTEGER NOT NULL,
          incident_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS incidents_received_at
          ON incidents(received_at_ms DESC);
      `);
    });
  }

  private ensureJurisdiction(jurisdictionId: string): void {
    jurisdictionIdSchema.parse(jurisdictionId);
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM metadata WHERE key = 'jurisdiction_id'")
      .toArray()[0];
    if (row && row.value !== jurisdictionId) throw new Error("Incident jurisdiction mismatch");
    if (!row) {
      this.ctx.storage.sql.exec(
        "INSERT INTO metadata (key, value) VALUES ('jurisdiction_id', ?)",
        jurisdictionId,
      );
    }
  }

  private readIncident(id: string): StoredIncident | null {
    const row = this.ctx.storage.sql
      .exec<IncidentRow>("SELECT incident_json FROM incidents WHERE incident_id = ?", id)
      .toArray()[0];
    return row ? storedIncidentSchema.parse(JSON.parse(row.incident_json)) : null;
  }

  async createRawIncident(jurisdictionId: string, sosJson: string): Promise<string> {
    this.ensureJurisdiction(jurisdictionId);
    const sos = sosRequestSchema.parse(JSON.parse(sosJson));
    if (sos.jurisdictionId !== jurisdictionId) throw new Error("Incident jurisdiction mismatch");
    const existing = this.ctx.storage.sql
      .exec<{ incident_json: string }>(
        "SELECT incident_json FROM incidents WHERE idempotency_key = ?",
        sos.idempotencyKey,
      )
      .toArray()[0];
    if (existing) return existing.incident_json;

    const incident = initialIncident(jurisdictionId, sos);
    const incidentJson = JSON.stringify(incident);
    this.ctx.storage.sql.exec(
      `INSERT INTO incidents
       (incident_id, idempotency_key, version, received_at_ms, incident_json)
       VALUES (?, ?, ?, ?, ?)`,
      incident.id,
      sos.idempotencyKey,
      incident.version,
      Date.parse(incident.receivedAt),
      incidentJson,
    );
    return incidentJson;
  }

  /** DEV-ONLY: wipe all incidents (used by the demo seeding route). */
  async resetIncidents(jurisdictionId: string): Promise<void> {
    this.ensureJurisdiction(jurisdictionId);
    this.ctx.storage.sql.exec("DELETE FROM incidents");
  }

  /**
   * DEV-ONLY: insert a fully-formed incident record for demos/seeding.
   * Upserts by incident id so re-seeding is idempotent. Not used by any
   * production flow (guarded by a non-production route).
   */
  async seedIncident(jurisdictionId: string, incidentJson: string): Promise<void> {
    this.ensureJurisdiction(jurisdictionId);
    const incoming = JSON.parse(incidentJson) as Record<string, unknown>;
    const incident = storedIncidentSchema.parse({
      triageStatus: "complete",
      geoStatus: "complete",
      sourceLocation: null,
      ...incoming,
      jurisdictionId,
    });
    const stored = JSON.stringify(incident);
    this.ctx.storage.sql.exec(
      `INSERT INTO incidents
         (incident_id, idempotency_key, version, received_at_ms, incident_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(incident_id) DO UPDATE SET
         version = excluded.version,
         received_at_ms = excluded.received_at_ms,
         incident_json = excluded.incident_json`,
      incident.id,
      `seed:${incident.id}`,
      incident.version,
      Date.parse(incident.receivedAt),
      stored,
    );
  }

  async listIncidentJson(jurisdictionId: string): Promise<string> {
    this.ensureJurisdiction(jurisdictionId);
    const incidents = this.ctx.storage.sql
      .exec<{ incident_json: string }>(
        "SELECT incident_json FROM incidents ORDER BY received_at_ms DESC LIMIT 500",
      )
      .toArray()
      .map((row) => storedIncidentSchema.parse(JSON.parse(row.incident_json)));
    return JSON.stringify(incidents);
  }

  async getIncidentJson(jurisdictionId: string, id: string): Promise<string | null> {
    this.ensureJurisdiction(jurisdictionId);
    const incident = this.readIncident(id);
    return incident ? JSON.stringify(incident) : null;
  }

  async patchIncident(
    jurisdictionId: string,
    id: string,
    expectedVersion: number,
    patchJson: string,
  ): Promise<StoreMutationResult> {
    const patch = incidentPatchSchema.parse(JSON.parse(patchJson));
    return this.mutate(jurisdictionId, id, expectedVersion, (current) => ({
      patch: enrichmentFields(current, patch),
    }));
  }

  async claim(
    jurisdictionId: string,
    id: string,
    expectedVersion: number,
    operator: string,
  ): Promise<StoreMutationResult> {
    return this.mutate(jurisdictionId, id, expectedVersion, (incident) => {
      if (incident.claimedBy && incident.claimedBy !== operator) {
        return { error: { code: 423, message: "Another operator holds the approval lock" } };
      }
      if (["DISPATCHED", "CLOSED"].includes(incident.status)) {
        return { error: { code: 409, message: "This incident can no longer be claimed" } };
      }
      return {
        patch: {
          status: "CLAIMED",
          claimedBy: operator,
          viewers: Array.from(new Set([...incident.viewers, operator])),
          activity: appendActivity(incident.activity, operator, "Claimed incident"),
        },
      };
    });
  }

  async dispatch(
    jurisdictionId: string,
    id: string,
    expectedVersion: number,
    operator: string,
    draft: DispatchDraft,
  ): Promise<StoreMutationResult> {
    return this.mutate(jurisdictionId, id, expectedVersion, (incident) => {
      if (incident.claimedBy !== operator || incident.status !== "CLAIMED") {
        return { error: { code: 403, message: "Claim this incident before dispatching it" } };
      }
      return {
        patch: {
          category: draft.category,
          priority: draft.priority,
          peopleCount: draft.peopleCount,
          injuries: draft.injuries,
          hazards: draft.hazards,
          accessibilityNeeds: draft.accessibilityNeeds,
          destinationAgency: draft.destinationAgency,
          requestedResponse: draft.requestedResponse,
          location: { ...incident.location, address: draft.address },
          status: "DISPATCHING",
          missingFields: [],
          failureReason: undefined,
          activity: appendActivity(
            incident.activity,
            operator,
            "Dispatch workflow started",
            `${draft.destinationAgency}: ${draft.requestedResponse}`,
          ),
        },
      };
    });
  }

  async completeDispatch(
    jurisdictionId: string,
    id: string,
    operator: string,
  ): Promise<StoreMutationResult> {
    const current = this.readIncident(id);
    if (!current) return { ok: false, code: 404, message: "Incident not found" };
    return this.mutate(jurisdictionId, id, current.version, (incident) => {
      if (incident.status !== "DISPATCHING") {
        return { error: { code: 409, message: "Dispatch is no longer awaiting delivery" } };
      }
      return {
        patch: {
          status: "DISPATCHED",
          activity: appendActivity(incident.activity, operator, "Dispatch delivery acknowledged"),
        },
      };
    });
  }

  async cancelDispatch(
    jurisdictionId: string,
    id: string,
    operator: string,
  ): Promise<StoreMutationResult> {
    const current = this.readIncident(id);
    if (!current) return { ok: false, code: 404, message: "Incident not found" };
    return this.mutate(jurisdictionId, id, current.version, (incident) => {
      if (incident.status !== "DISPATCHING") {
        return { error: { code: 409, message: "Dispatch is no longer pending" } };
      }
      return {
        patch: {
          status: "CLAIMED",
          failureReason: "Dispatch workflow could not start. Retry dispatch.",
          activity: appendActivity(incident.activity, operator, "Dispatch workflow failed to start"),
        },
      };
    });
  }

  async performAction(
    jurisdictionId: string,
    id: string,
    expectedVersion: number,
    operator: string,
    action: IncidentAction,
  ): Promise<StoreMutationResult> {
    const labels: Record<IncidentAction, string> = {
      REQUEST_CLARIFICATION: "Requested caller clarification",
      ESCALATE: "Escalated to duty supervisor",
      MARK_DUPLICATE: "Marked incident as duplicate",
      RETRY_DISPATCH: "Dispatch retried successfully",
    };

    return this.mutate(jurisdictionId, id, expectedVersion, (incident) => {
      if (incident.claimedBy !== operator) {
        return { error: { code: 403, message: "Claim this incident before changing it" } };
      }
      if (incident.status === "CLOSED") {
        return { error: { code: 409, message: "This incident is already closed" } };
      }
      return {
        patch: {
          status:
            action === "MARK_DUPLICATE"
              ? "CLOSED"
              : action === "RETRY_DISPATCH"
                ? "DISPATCHED"
                : incident.status,
          priority: action === "ESCALATE" ? "CRITICAL" : incident.priority,
          failureReason: action === "RETRY_DISPATCH" ? undefined : incident.failureReason,
          activity: appendActivity(incident.activity, operator, labels[action]),
        },
      };
    });
  }

  private async mutate(
    jurisdictionId: string,
    id: string,
    expectedVersion: number,
    update: (incident: StoredIncident) => IncidentUpdate,
  ): Promise<StoreMutationResult> {
    this.ensureJurisdiction(jurisdictionId);
    const current = this.readIncident(id);
    if (!current) return { ok: false, code: 404, message: "Incident not found" };
    if (current.version !== expectedVersion) {
      return {
        ok: false,
        code: 409,
        message:
          "This incident changed after you opened it. Review the latest version before dispatching.",
        currentVersion: current.version,
      };
    }

    const updateResult = update(current);
    if ("error" in updateResult) return { ok: false, ...updateResult.error };
    const effectivePatch = updateResult.patch;
    const stored = storedIncidentSchema.parse({
      ...current,
      ...effectivePatch,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    const incidentJson = JSON.stringify(stored);
    this.ctx.storage.sql.exec(
      `UPDATE incidents SET version = ?, incident_json = ?
       WHERE incident_id = ? AND version = ?`,
      stored.version,
      incidentJson,
      id,
      expectedVersion,
    );

    // Best-effort immutable audit trail. writeAudit never throws.
    const lastActivity = Array.isArray(stored.activity)
      ? stored.activity[stored.activity.length - 1]
      : undefined;
    await writeAudit(this.env.AUDIT_DB, {
      incidentId: id,
      version: stored.version,
      actor: lastActivity?.actor ?? "system",
      action: lastActivity?.action ?? "mutation",
      detail: lastActivity?.detail,
      jurisdictionId,
    });

    return {
      ok: true,
      incidentJson,
      patchJson: JSON.stringify(effectivePatch),
    };
  }
}
