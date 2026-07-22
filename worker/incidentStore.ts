import { DurableObject } from "cloudflare:workers";
import {
  incidentSchema,
  type Activity,
  type DispatchDraft,
  type Incident,
} from "../src/lib/schemas";
import { demoIncidents } from "../src/lib/demoData";

/**
 * Backend 1 — Incident Store + REST API (system of record).
 *
 * One IncidentStore instance per jurisdiction (getByName(jurisdictionId)).
 * Holds the authoritative incident list with per-incident version counters
 * and enforces optimistic concurrency: a mutation with a stale expectedVersion
 * returns a 409 (surfaced to the client as VersionConflictError).
 *
 * SEAM FOR BACKEND 2: every successful mutation calls `notifyRealtime(...)`.
 * BE2 wires that to the jurisdiction WebSocket hub so the console gets live
 * `incident.created` / `incident.patch` events. It is a no-op until the
 * REALTIME_HUB binding exists, so BE1 works standalone.
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

interface StoreEnv {
  // Optional cross-DO hook implemented by Backend 2. Left loose on purpose.
  REALTIME_HUB?: {
    getByName(name: string): { publish(event: unknown): Promise<void> };
  };
}

export class IncidentStore extends DurableObject<StoreEnv> {
  private incidents = new Map<string, Incident>();
  private jurisdiction = "metro-central";
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: StoreEnv) {
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
    return this.mutate(id, expectedVersion, (incident) => ({
      ...incident,
      status: "CLAIMED",
      claimedBy: OPERATOR,
      viewers: Array.from(new Set([...incident.viewers, OPERATOR])),
      activity: appendActivity(incident.activity, "Claimed incident"),
    }));
  }

  async dispatch(
    id: string,
    expectedVersion: number,
    draft: DispatchDraft,
  ): Promise<MutationResult> {
    return this.mutate(id, expectedVersion, (incident) => ({
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
      activity: appendActivity(
        incident.activity,
        "Approved and dispatched",
        `${draft.destinationAgency}: ${draft.requestedResponse}`,
      ),
    }));
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

    return this.mutate(id, expectedVersion, (incident) => ({
      ...incident,
      status:
        action === "MARK_DUPLICATE"
          ? "CLOSED"
          : action === "RETRY_DISPATCH"
            ? "DISPATCHED"
            : incident.status,
      priority: action === "ESCALATE" ? "CRITICAL" : incident.priority,
      failureReason: action === "RETRY_DISPATCH" ? undefined : incident.failureReason,
      activity: appendActivity(incident.activity, labels[action]),
    }));
  }

  /**
   * SEAM FOR BACKEND 2: injects an incident from the (simulated) SOS ingest
   * pipeline. Returns the stored, version-1 incident and fires a realtime
   * `incident.created` event.
   */
  async createIncident(incident: Incident): Promise<Incident> {
    await this.ready;
    const stored = incidentSchema.parse({ ...incident, version: 1 });
    this.incidents.set(stored.id, stored);
    await this.persist();
    await this.notifyRealtime({ type: "incident.created", incident: stored });
    return stored;
  }

  private async mutate(
    id: string,
    expectedVersion: number,
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
    });
    this.incidents.set(id, next);
    await this.persist();
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

  private async notifyRealtime(event: unknown): Promise<void> {
    try {
      const hub = this.env.REALTIME_HUB?.getByName(this.jurisdiction);
      if (hub) await hub.publish(event);
    } catch (error) {
      console.warn("Realtime notify skipped", error);
    }
  }
}

const appendActivity = (
  activity: Activity[],
  action: string,
  detail?: string,
): Activity[] => [
  ...activity,
  {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: OPERATOR,
    action,
    ...(detail ? { detail } : {}),
  },
];
