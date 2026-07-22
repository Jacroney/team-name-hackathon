import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
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

export interface OperatorPrincipal {
  id: string;
  name: string;
  role: "dispatcher";
}

async function accessPrincipal(request: Request, env: Env): Promise<OperatorPrincipal | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return null;
    throw new HttpError(503, "access_not_configured", "Cloudflare Access is not configured");
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new HttpError(401, "access_auth_required", "Cloudflare Access authentication required");

  try {
    const { payload } = await jwtVerify(
      token,
      createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)),
      { issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
    );
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("missing subject");
    const email = typeof payload.email === "string" ? payload.email : undefined;
    return { id: payload.sub, name: email ?? env.OPERATOR_NAME, role: "dispatcher" };
  } catch {
    throw new HttpError(401, "access_auth_invalid", "Cloudflare Access authentication failed");
  }
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

export async function authorizeOperator(request: Request, env: Env): Promise<OperatorPrincipal> {
  const access = await accessPrincipal(request, env);
  if (access) return access;
  const token = bearerToken(request);
  if (!token || !(await constantTimeEqual(token, env.OPERATOR_API_TOKEN))) {
    throw new HttpError(401, "operator_auth_required", "Operator authentication failed");
  }
  return { id: env.OPERATOR_NAME, name: env.OPERATOR_NAME, role: "dispatcher" };
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint a short-lived HMAC-signed hub token for a WebSocket connection.
 * Mirrors the verification in authenticateHubConnection: `payload.signature`,
 * both base64url, signed with HUB_AUTH_SECRET. Used by the /api/realtime/token
 * endpoint so the browser can authenticate the realtime stream.
 */
export async function issueHubToken(
  env: Env,
  operator: OperatorPrincipal,
  ttlSeconds = 300,
): Promise<string> {
  const principal: HubPrincipal = {
    sub: operator.id,
    role: "dispatcher",
    jurisdictionId: env.JURISDICTION_ID,
    exp: Math.floor(Date.now() / 1_000) + ttlSeconds,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(principal));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.HUB_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes));
  return `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(signature)}`;
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
  const access = await accessPrincipal(request, env);
  if (access) {
    return {
      sub: access.id,
      role: access.role,
      jurisdictionId: env.JURISDICTION_ID,
      exp: Math.floor(Date.now() / 1_000) + 60,
    };
  }
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
