import { realtimeEventSchema, type RealtimeEvent } from "./schemas";

export type RealtimeStatus = "connecting" | "connected" | "stale" | "disconnected";

interface IncidentStreamOptions {
  jurisdictionId: string;
  onEvent: (event: RealtimeEvent) => void;
  onStatus: (status: RealtimeStatus) => void;
}

const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL;

export const connectIncidentStream = ({
  jurisdictionId,
  onEvent,
  onStatus,
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
    socket = new WebSocket(url);

    socket.addEventListener("open", markMessageReceived);
    socket.addEventListener("message", (message) => {
      markMessageReceived();
      try {
        onEvent(realtimeEventSchema.parse(JSON.parse(String(message.data))));
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

  return () => {
    stopped = true;
    socket?.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (staleTimer) window.clearInterval(staleTimer);
  };
};
