import { dispatchDraftSchema } from "../src/lib/schemas";
import { IncidentStore, type IncidentAction } from "./incidentStore";

export { IncidentStore };

export interface Env {
  INCIDENT_STORE: DurableObjectNamespace<IncidentStore>;
  ASSETS: Fetcher;
  JURISDICTION_ID?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

const VALID_ACTIONS: IncidentAction[] = [
  "REQUEST_CLARIFICATION",
  "ESCALATE",
  "MARK_DUPLICATE",
  "RETRY_DISPATCH",
];

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

const error = (message: string, status: number): Response =>
  json({ message }, status);

// Structural result shape. DO RPC stubs widen tuple types (e.g. coordinates
// [number, number] -> number[]), so we accept a loose shape rather than the
// nominal MutationResult here.
type ApiResult =
  | { ok: true; incident: unknown }
  | { ok: false; code: number; message: string };

/** Maps a DO result onto an HTTP response (409/404 → client errors). */
const respond = (result: ApiResult): Response =>
  result.ok ? json(result.incident) : error(result.message, result.code);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Everything outside /incidents is the React SPA (static assets).
    if (pathname !== "/incidents" && !pathname.startsWith("/incidents/")) {
      return env.ASSETS.fetch(request);
    }

    const jurisdiction = env.JURISDICTION_ID ?? "metro-central";
    const store = env.INCIDENT_STORE.getByName(jurisdiction);
    await store.init(jurisdiction);

    try {
      // GET /incidents
      if (pathname === "/incidents" && request.method === "GET") {
        return json(await store.list());
      }

      const segments = pathname.split("/").filter(Boolean); // ["incidents", ":id", action?]
      const id = segments[1] ? decodeURIComponent(segments[1]) : undefined;
      const action = segments[2];

      if (!id) return error("Not found", 404);

      // GET /incidents/:id
      if (!action && request.method === "GET") {
        return respond(await store.getOne(id));
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}) as Record<string, unknown>);
        const expectedVersion = Number((body as { expectedVersion?: unknown }).expectedVersion);
        if (!Number.isInteger(expectedVersion)) {
          return error("expectedVersion is required", 400);
        }

        if (action === "claim") {
          return respond(await store.claim(id, expectedVersion));
        }

        if (action === "dispatch") {
          const parsed = dispatchDraftSchema.safeParse(
            (body as { incident?: unknown }).incident,
          );
          if (!parsed.success) return error("Invalid dispatch draft", 400);
          return respond(await store.dispatch(id, expectedVersion, parsed.data));
        }

        if (action === "actions") {
          const requested = (body as { action?: unknown }).action;
          if (typeof requested !== "string" || !VALID_ACTIONS.includes(requested as IncidentAction)) {
            return error("Invalid action", 400);
          }
          return respond(await store.performAction(id, expectedVersion, requested as IncidentAction));
        }
      }

      return error("Not found", 404);
    } catch (err) {
      console.error("Incident API error", err);
      return error("Internal error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
