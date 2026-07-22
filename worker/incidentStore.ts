import { DurableObject } from "cloudflare:workers";
import {
  incidentSchema,
  type Activity,
  type DispatchDraft,
  type Evidence,
  type Incident,
} from "../src/lib/schemas";
import { demoIncidents } from "../src/lib/demoData";
import type { Env } from "./env";
import { recordMetric, writeAudit } from "./dataLayer";

/**
 * Backend 1 — Incident Store + REST API (system of record).
 *
 * One IncidentStore instance per jurisdiction (getByName(jurisdictionId)).
 * Holds the authoritative incident list with per-incident version counters
 * and enforces optimistic concurrency: a mutation with a stale expectedVersion
 * returns a 409 (surfaced to the client as VersionConflictError).
 *
 * Every successful mutation fans out to the BE1 data layer:
 *   - D1 (AUDIT_DB): immutable audit trail
 *   - Analytics Engine (METRICS): one datapoint per mutation
 * and calls notifyRealtime(), the seam Backend 2 wires to the WebSocket hub.
 */

const OPERATOR = "Console Operator";

export type MutationResult =
  | { ok: true; incident: Incident }
  | { ok: false; code: number; message: string };

export type IncidentAction =
  | "REQUEST_CLARIFICATION"
  | "ESCALATE"
  | "MARK_DUPLICATE"
  | "RETRY_DISPATCH";

export class IncidentStore extends DurableObject<Env> {
  private incidents = new Map<string, Incident>();
  private jurisdiction = "metro-central";
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<Incident[]>("incidents");
      const seed = stored ?? demoIncidents;
      for (const incident of seed) this.incidents.set(incident.id, incident);
      if (!stored) await this.persist();
    });
  }

  /** Called once by the Worker so the store knows which jurisdiction it serves. */
  async init(jurisdiction: string): Promise<void> {
    await this.ready;
    this.jurisdiction = jurisdiction;
  }

  async list(): Promise<Incident[]> {
    await this.ready;
    return [...this.incidents.values()].sort(
      (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
    );
  }

  async getOne(id: string): Promise<MutationResult> {
    await this.ready;
    const incident = this.incidents.get(id);
    if (!incident) return { ok: false, code: 404, message: "Incident not found" };
    return { ok: true, incident };
  }

  async claim(id: string, expectedVersion: number): Promise<MutationResult> {
    return this.mutate(id, expectedVersion, "Claimed incident", undefined, (incident) => ({
      ...incident,
      status: "CLAIMED",
      claimedBy: OPERATOR,
      viewers: Array.from(new Set([...incident.viewers, OPERATOR])),
    }));
  }

  async dispatch(
    id: string,
    expectedVersion: number,
    draft: DispatchDraft,
  ): Promise<MutationResult> {
    return this.mutate(
      id,
      expectedVersion,
      "Approved and dispatched",
      `${draft.destinationAgency}: ${draft.requestedResponse}`,
      (incident) => ({
        ...incident,
        category: draft.category,
        priority: draft.priority,
        peopleCount: draft.peopleCount,
        injuries: draft.injuries,
        hazards: draft.hazards,
        accessibilityNeeds: draft.accessibilityNeeds,
        destinationAgency: draft.destinationAgency,
        requestedResponse: draft.requestedResponse,
        location: { ...incident.location, address: draft.address },
        status: "DISPATCHED",
        claimedBy: incident.claimedBy ?? OPERATOR,
        missingFields: [],
        failureReason: undefined,
      }),
    );
  }

  async performAction(
    id: string,
    expectedVersion: number,
    action: IncidentAction,
  ): Promise<MutationResult> {
    const labels: Record<IncidentAction, string> = {
      REQUEST_CLARIFICATION: "Requested caller clarification",
      ESCALATE: "Escalated to duty supervisor",
      MARK_DUPLICATE: "Marked incident as duplicate",
      RETRY_DISPATCH: "Dispatch retried successfully",
    };

    return this.mutate(id, expectedVersion, labels[action], undefined, (incident) => ({
      ...incident,
      status:
        action === "MARK_DUPLICATE"
          ? "CLOSED"
          : action === "RETRY_DISPATCH"
            ? "DISPATCHED"
            : incident.status,
      priority: action === "ESCALATE" ? "CRITICAL" : incident.priority,
      failureReason: action === "RETRY_DISPATCH" ? undefined : incident.failureReason,
    }));
  }

  /** Attach an uploaded evidence artifact (stored in R2) to the incident record. */
  async attachEvidence(
    id: string,
    expectedVersion: number,
    evidence: Evidence,
  ): Promise<MutationResult> {
    return this.mutate(
      id,
      expectedVersion,
      "Attached evidence",
      evidence.label,
      (incident) => ({ ...incident, evidence: [...incident.evidence, evidence] }),
    );
  }

  private async mutate(
    id: string,
    expectedVersion: number,
    action: string,
    detail: string | undefined,
    update: (incident: Incident) => Incident,
  ): Promise<MutationResult> {
    await this.ready;
    const current = this.incidents.get(id);
    if (!current) return { ok: false, code: 404, message: "Incident not found" };
    if (current.version !== expectedVersion) {
      return {
        ok: false,
        code: 409,
        message:
          "This incident changed after you opened it. Review the latest version before dispatching.",
      };
    }

    const next = incidentSchema.parse({
      ...update(current),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      activity: [
        ...current.activity,
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          actor: OPERATOR,
          action,
          ...(detail ? { detail } : {}),
        } satisfies Activity,
      ],
    });
    this.incidents.set(id, next);
    await this.persist();

    // BE1 durable side-effects (best-effort, never block the mutation).
    const auditRow = {
      incidentId: next.id,
      version: next.version,
      actor: OPERATOR,
      action,
      detail,
      category: next.category,
      priority: next.priority,
      status: next.status,
    };
    await writeAudit(this.env, auditRow);
    recordMetric(this.env, auditRow);
    await this.notifyRealtime({
      type: "incident.patch",
      incidentId: next.id,
      version: next.version,
      patch: next,
    });

    return { ok: true, incident: next };
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("incidents", [...this.incidents.values()]);
  }

  /** SEAM FOR BACKEND 2: wire to the jurisdiction WebSocket hub. No-op today. */
  private async notifyRealtime(_event: unknown): Promise<void> {
    // Backend 2 implements: env.REALTIME_HUB.getByName(this.jurisdiction).publish(_event)
  }
}
