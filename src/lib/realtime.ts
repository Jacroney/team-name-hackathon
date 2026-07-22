import { z } from "zod";
import { incidentSchema, realtimeEventSchema, type RealtimeEvent } from "./schemas";

export type RealtimeStatus = "connecting" | "connected" | "stale" | "disconnected";

interface IncidentStreamOptions {
  jurisdictionId: string;
  onEvent: (event: RealtimeEvent) => void;
  onStatus: (status: RealtimeStatus) => void;
  /** Optional signed hub token; sent as a `cm-auth.<token>` subprotocol. */
  authToken?: string | null;
}

const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL;

const hubEventSchema = z.object({
  type: z.enum(["incident.created", "incident.patch"]),
  incidentId: z.string(),
  incidentVersion: z.number().int().positive(),
  payload: z.object({ incident: incidentSchema }).partial().passthrough(),
}).passthrough();

function emitHubEvent(value: unknown, onEvent: (event: RealtimeEvent) => void): void {
  if (typeof value !== "object" || value === null) return;
  const raw = value as { type?: unknown; incidents?: unknown };
  if (raw.type === "snapshot" && Array.isArray(raw.incidents)) {
    for (const incident of raw.incidents) onEvent({ type: "incident.created", incident: incidentSchema.parse(incident) });
    return;
  }
  const hubEvent = hubEventSchema.safeParse(value);
  if (!hubEvent.success) return;
  if (hubEvent.data.type === "incident.created" && hubEvent.data.payload.incident) {
    onEvent({ type: "incident.created", incident: hubEvent.data.payload.incident });
    return;
  }
  onEvent(realtimeEventSchema.parse({
    type: "incident.patch",
    incidentId: hubEvent.data.incidentId,
    version: hubEvent.data.incidentVersion,
    patch: hubEvent.data.payload.patch,
  }));
}

export const connectIncidentStream = ({
  jurisdictionId,
  onEvent,
  onStatus,
  authToken,
}: IncidentStreamOptions): (() => void) => {
  let stopped = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let staleTimer: number | undefined;
  let lastMessageAt = Date.now();

  const markMessageReceived = (): void => {
    lastMessageAt = Date.now();
    onStatus("connected");
  };

  if (!WEBSOCKET_URL) {
    onStatus("connecting");
    const connectTimer = window.setTimeout(() => onStatus("connected"), 280);
    const heartbeatTimer = window.setInterval(markMessageReceived, 5_000);
    const patchTimer = window.setTimeout(() => {
      onEvent({
        type: "incident.patch",
        incidentId: "CM-0722-0044",
        version: 2,
        patch: {
          callerConnection: "CONNECTED",
          updatedAt: new Date().toISOString(),
        },
      });
    }, 8_000);
    const presenceTimer = window.setTimeout(() => {
      onEvent({
        type: "presence",
        incidentId: "CM-0722-0017",
        viewers: ["M. Chen", "R. Singh", "J. Lewis"],
      });
    }, 11_000);

    return () => {
      window.clearTimeout(connectTimer);
      window.clearTimeout(patchTimer);
      window.clearTimeout(presenceTimer);
      window.clearInterval(heartbeatTimer);
    };
  }

  const openSocket = (): void => {
    if (stopped) return;
    onStatus("connecting");
    const url = new URL(WEBSOCKET_URL);
    url.searchParams.set("jurisdiction", jurisdictionId);
    const protocols = authToken ? ["crisis-mesh", `cm-auth.${authToken}`] : "crisis-mesh";
    socket = new WebSocket(url, protocols);

    socket.addEventListener("open", markMessageReceived);
    socket.addEventListener("message", (message) => {
      markMessageReceived();
      try {
        emitHubEvent(JSON.parse(String(message.data)), onEvent);
      } catch (error) {
        console.warn("Ignored invalid realtime event", error);
      }
    });
    socket.addEventListener("close", () => {
      if (stopped) return;
      onStatus("disconnected");
      reconnectTimer = window.setTimeout(openSocket, 2_000);
    });
    socket.addEventListener("error", () => socket?.close());
  };

  staleTimer = window.setInterval(() => {
    if (Date.now() - lastMessageAt > 15_000 && socket?.readyState === WebSocket.OPEN) onStatus("stale");
  }, 1_000);
  openSocket();
  const heartbeatTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat" }));
  }, 10_000);

  return () => {
    stopped = true;
    socket?.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (staleTimer) window.clearInterval(staleTimer);
    window.clearInterval(heartbeatTimer);
  };
};
