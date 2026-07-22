import type { RealtimeStatus } from "../lib/realtime";

interface ConnectionStatusProps {
  status: RealtimeStatus;
}

const labels: Record<RealtimeStatus, string> = {
  connecting: "Connecting",
  connected: "Live",
  stale: "Stale feed",
  disconnected: "Offline",
};

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  return (
    <div className="connection-status" data-status={status} role="status">
      <span className="connection-dot" aria-hidden="true" />
      <span className="connection-label">Connection</span>
      <strong>{labels[status]}</strong>
    </div>
  );
}
