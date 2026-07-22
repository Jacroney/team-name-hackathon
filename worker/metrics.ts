export type OperationalMetric =
  | "sos.requests_received"
  | "incident.creation_latency_ms"
  | "ai.triage_latency_ms"
  | "ai.failure"
  | "geo.analysis_latency_ms"
  | "geo.failure"
  | "websocket.active_connections"
  | "websocket.broadcast_fanout"
  | "websocket.reconnections"
  | "websocket.heartbeat_expirations"
  | "queue.retries"
  | "dispatcher.time_to_first_view_ms";

interface MetricInput {
  jurisdictionId: string;
  value?: number;
  outcome?: string;
  pipeline?: "ai" | "geo" | "realtime" | "ingest";
}

export function recordMetric(
  dataset: AnalyticsEngineDataset,
  name: OperationalMetric,
  { jurisdictionId, value = 1, outcome = "ok", pipeline = "ingest" }: MetricInput,
): void {
  dataset.writeDataPoint({
    indexes: [jurisdictionId],
    blobs: [name, outcome, pipeline],
    doubles: [value, Date.now()],
  });
}
