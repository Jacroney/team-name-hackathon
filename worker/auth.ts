import { z } from "zod";
import { hubPrincipalSchema, type HubPrincipal, type SosRequest } from "./contracts";
import { HttpError } from "./errors";

const turnstileResponseSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().optional(),
    action: z.string().optional(),
  })
  .passthrough();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

async function constantTimeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function verifyTurnstile(
  request: Request,
  body: SosRequest,
  env: Env,
): Promise<boolean> {
  if (!body.turnstileToken) return false;

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", body.turnstileToken);
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!response.ok) return false;

  const parsed = turnstileResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.success) return false;
  if (parsed.data.action !== "sos") return false;
  if (!env.TURNSTILE_HOSTNAME) return false;
  return parsed.data.hostname === env.TURNSTILE_HOSTNAME;
}

export async function authorizeSos(request: Request, body: SosRequest, env: Env): Promise<void> {
  const token = bearerToken(request);
  if (token && (await constantTimeEqual(token, env.SOS_INGEST_TOKEN))) return;
  if (await verifyTurnstile(request, body, env)) return;
  throw new HttpError(401, "intake_auth_required", "SOS intake authentication failed");
}

export async function authorizeOperator(request: Request, env: Env): Promise<void> {
  const token = bearerToken(request);
  if (!token || !(await constantTimeEqual(token, env.OPERATOR_API_TOKEN))) {
    throw new HttpError(401, "operator_auth_required", "Operator authentication failed");
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function websocketToken(request: Request): string | null {
  const authorizationToken = bearerToken(request);
  if (authorizationToken) return authorizationToken;

  const protocols = request.headers
    .get("Sec-WebSocket-Protocol")
    ?.split(",")
    .map((protocol) => protocol.trim());
  const authProtocol = protocols?.find((protocol) => protocol.startsWith("cm-auth."));
  return authProtocol?.slice("cm-auth.".length) ?? null;
}

export async function authenticateHubConnection(request: Request, env: Env): Promise<HubPrincipal> {
  const token = websocketToken(request);
  if (!token) throw new HttpError(401, "hub_auth_required", "Realtime authentication required");

  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) {
    throw new HttpError(401, "hub_token_invalid", "Realtime token is invalid");
  }

  try {
    const payloadBytes = decodeBase64Url(payloadPart);
    const signature = decodeBase64Url(signaturePart);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.HUB_AUTH_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify("HMAC", key, signature, payloadBytes);
    if (!valid) throw new Error("invalid signature");

    const principal = hubPrincipalSchema.parse(JSON.parse(new TextDecoder().decode(payloadBytes)));
    if (principal.exp <= Math.floor(Date.now() / 1_000)) throw new Error("expired token");
    return principal;
  } catch {
    throw new HttpError(401, "hub_token_invalid", "Realtime token is invalid");
  }
}
