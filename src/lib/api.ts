import { demoIncidents } from "./demoData";
import {
  dispatchDraftSchema,
  incidentListSchema,
  incidentSchema,
  type DispatchDraft,
  type Incident,
} from "./schemas";

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
const USE_API = Boolean(import.meta.env.VITE_API_URL);
const OPERATOR_TOKEN = import.meta.env.VITE_OPERATOR_TOKEN;
const DEMO_OPERATOR = "A. Okafor";

// When Cloudflare Access fronts the app it injects the auth header itself; for
// local/dev (no Access) we send the operator bearer token when configured.
const authHeaders = (): Record<string, string> =>
  OPERATOR_TOKEN ? { Authorization: `Bearer ${OPERATOR_TOKEN}` } : {};
let demoStore = structuredClone(demoIncidents);

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export class VersionConflictError extends Error {
  constructor() {
    super("This incident changed after you opened it. Review the latest version before dispatching.");
    this.name = "VersionConflictError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const request = async <T>(path: string, schema: { parse: (value: unknown) => T }, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...authHeaders(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 409 || response.status === 412) throw new VersionConflictError();
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed with status ${response.status}`, response.status);
  }

  return schema.parse(await response.json());
};

const readDemoIncident = (id: string): Incident => {
  const incident = demoStore.find((candidate) => candidate.id === id);
  if (!incident) throw new ApiError("Incident not found", 404);
  return structuredClone(incident);
};

const updateDemoIncident = async (
  id: string,
  expectedVersion: number,
  update: (incident: Incident) => Incident,
  latency = 650,
): Promise<Incident> => {
  await sleep(latency);
  const current = readDemoIncident(id);
  if (current.version !== expectedVersion) throw new VersionConflictError();

  const next = incidentSchema.parse({
    ...update(current),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  });
  demoStore = demoStore.map((incident) => (incident.id === id ? next : incident));
  return structuredClone(next);
};

export const isApiEnabled = (): boolean => USE_API;

/**
 * Fetch a short-lived realtime auth token from the backend. Returns null when
 * running against demo data (no API) so the caller can fall back gracefully.
 */
export const getRealtimeToken = async (): Promise<string | null> => {
  if (!USE_API) return null;
  const response = await fetch(`${API_URL}/api/realtime/token`, {
    headers: { Accept: "application/json", ...authHeaders() },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { token?: string } | null;
  return body?.token ?? null;
};

export const listIncidents = async (): Promise<Incident[]> => {
  if (USE_API) return request("/api/incidents", incidentListSchema);
  await sleep(220);
  return structuredClone(demoStore);
};

export const getIncident = async (id: string): Promise<Incident> => {
  if (USE_API) return request(`/api/incidents/${encodeURIComponent(id)}`, incidentSchema);
  await sleep(120);
  return readDemoIncident(id);
};

export const claimIncident = async (id: string, expectedVersion: number): Promise<Incident> => {
  if (USE_API) {
    return request(`/api/incidents/${encodeURIComponent(id)}/claim`, incidentSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  }

  return updateDemoIncident(id, expectedVersion, (incident) => ({
    ...incident,
    status: "CLAIMED",
    claimedBy: DEMO_OPERATOR,
    viewers: Array.from(new Set([...incident.viewers, DEMO_OPERATOR])),
    activity: [
      ...incident.activity,
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        actor: DEMO_OPERATOR,
        action: "Claimed incident",
      },
    ],
  }));
};

interface DispatchIncidentInput {
  id: string;
  expectedVersion: number;
  draft: DispatchDraft;
}

export const dispatchIncident = async ({
  id,
  expectedVersion,
  draft,
}: DispatchIncidentInput): Promise<Incident> => {
  const parsedDraft = dispatchDraftSchema.parse(draft);
  if (USE_API) {
    return request(`/api/incidents/${encodeURIComponent(id)}/dispatch`, incidentSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, incident: parsedDraft }),
    });
  }

  return updateDemoIncident(
    id,
    expectedVersion,
    (incident) => ({
      ...incident,
      ...parsedDraft,
      location: { ...incident.location, address: parsedDraft.address },
      status: "DISPATCHED",
      claimedBy: incident.claimedBy ?? DEMO_OPERATOR,
      missingFields: [],
      failureReason: undefined,
      activity: [
        ...incident.activity,
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          actor: DEMO_OPERATOR,
          action: "Approved and dispatched",
          detail: `${parsedDraft.destinationAgency}: ${parsedDraft.requestedResponse}`,
        },
      ],
    }),
    1_050,
  );
};

export type IncidentAction = "REQUEST_CLARIFICATION" | "ESCALATE" | "MARK_DUPLICATE" | "RETRY_DISPATCH";

export const performIncidentAction = async (
  id: string,
  expectedVersion: number,
  action: IncidentAction,
): Promise<Incident> => {
  if (USE_API) {
    return request(`/api/incidents/${encodeURIComponent(id)}/actions`, incidentSchema, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, action }),
    });
  }

  return updateDemoIncident(id, expectedVersion, (incident) => {
    const actionLabels: Record<IncidentAction, string> = {
      REQUEST_CLARIFICATION: "Requested caller clarification",
      ESCALATE: "Escalated to duty supervisor",
      MARK_DUPLICATE: "Marked incident as duplicate",
      RETRY_DISPATCH: "Dispatch retried successfully",
    };

    return {
      ...incident,
      status:
        action === "MARK_DUPLICATE"
          ? "CLOSED"
          : action === "RETRY_DISPATCH"
            ? "DISPATCHED"
            : incident.status,
      priority: action === "ESCALATE" ? "CRITICAL" : incident.priority,
      failureReason: action === "RETRY_DISPATCH" ? undefined : incident.failureReason,
      activity: [
        ...incident.activity,
        {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          actor: DEMO_OPERATOR,
          action: actionLabels[action],
        },
      ],
    };
  });
};
