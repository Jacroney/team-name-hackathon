import { dispatchDraftSchema, type Evidence } from "../src/lib/schemas";
import type { Env } from "./env";
import { IncidentStore, type IncidentAction } from "./incidentStore";
import { getJurisdictionConfig, readAudit } from "./dataLayer";

export { IncidentStore };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
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

const error = (message: string, status: number): Response => json({ message }, status);

type ApiResult =
  | { ok: true; incident: unknown }
  | { ok: false; code: number; message: string };

const respond = (result: ApiResult): Response =>
  result.ok ? json(result.incident) : error(result.message, result.code);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const jurisdiction = env.JURISDICTION_ID ?? "metro-central";

    try {
      // KV — jurisdiction reference data (agency directory + districts).
      if (pathname === "/jurisdiction" && request.method === "GET") {
        return json(await getJurisdictionConfig(env, jurisdiction));
      }

      // R2 — evidence download: GET /evidence/<key...>
      if (pathname.startsWith("/evidence/") && request.method === "GET") {
        const key = decodeURIComponent(pathname.slice("/evidence/".length));
        const object = await env.EVIDENCE.get(key);
        if (!object) return error("Evidence not found", 404);
        const headers = new Headers(CORS_HEADERS);
        headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
        return new Response(object.body, { headers });
      }

      // Incident API
      if (pathname === "/incidents" || pathname.startsWith("/incidents/")) {
        const store = env.INCIDENT_STORE.getByName(jurisdiction);
        await store.init(jurisdiction);

        if (pathname === "/incidents" && request.method === "GET") {
          return json(await store.list());
        }

        const segments = pathname.split("/").filter(Boolean); // ["incidents", ":id", sub?]
        const id = segments[1] ? decodeURIComponent(segments[1]) : undefined;
        const sub = segments[2];
        if (!id) return error("Not found", 404);

        // GET /incidents/:id
        if (!sub && request.method === "GET") {
          return respond(await store.getOne(id));
        }

        // GET /incidents/:id/audit — D1 audit trail
        if (sub === "audit" && request.method === "GET") {
          return json(await readAudit(env, id));
        }

        // POST /incidents/:id/evidence — R2 upload + attach to record
        if (sub === "evidence" && request.method === "POST") {
          const expectedVersion = Number(url.searchParams.get("version"));
          if (!Number.isInteger(expectedVersion)) return error("version is required", 400);
          const label = url.searchParams.get("label") ?? "Evidence";
          const type = (url.searchParams.get("type") ?? "PHOTO") as Evidence["type"];
          const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
          const body = await request.arrayBuffer();
          if (body.byteLength === 0) return error("Empty upload", 400);

          const evidenceId = crypto.randomUUID();
          const key = `${id}/${evidenceId}`;
          await env.EVIDENCE.put(key, body, { httpMetadata: { contentType } });

          const evidence: Evidence = {
            id: evidenceId,
            type,
            label,
            timestamp: new Date().toISOString(),
            url: `${url.origin}/evidence/${encodeURIComponent(key)}`,
          };
          return respond(await store.attachEvidence(id, expectedVersion, evidence));
        }

        if (request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const expectedVersion = Number(body.expectedVersion);
          if (!Number.isInteger(expectedVersion)) return error("expectedVersion is required", 400);

          if (sub === "claim") return respond(await store.claim(id, expectedVersion));

          if (sub === "dispatch") {
            const parsed = dispatchDraftSchema.safeParse(body.incident);
            if (!parsed.success) return error("Invalid dispatch draft", 400);
            return respond(await store.dispatch(id, expectedVersion, parsed.data));
          }

          if (sub === "actions") {
            const requested = body.action;
            if (typeof requested !== "string" || !VALID_ACTIONS.includes(requested as IncidentAction)) {
              return error("Invalid action", 400);
            }
            return respond(await store.performAction(id, expectedVersion, requested as IncidentAction));
          }
        }

        return error("Not found", 404);
      }

      // Everything else is the React SPA.
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("API error", err);
      return error("Internal error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
