import type { IncidentStore } from "./incidentStore";

/**
 * Backend 1 environment — the incident system-of-record and its data layer.
 *
 * Scope is deliberately limited to persistence / records concerns:
 *   Workers + Durable Objects + Static Assets (core), plus
 *   D1 (audit log), KV (reference data), R2 (evidence), Analytics Engine (metrics).
 *
 * Realtime, Workers AI, Queues, Workflows and Browser Rendering belong to other
 * engineers' slices and are intentionally NOT bound here.
 */
export interface Env {
  INCIDENT_STORE: DurableObjectNamespace<IncidentStore>;
  ASSETS: Fetcher;

  CONFIG: KVNamespace;
  AUDIT_DB: D1Database;
  EVIDENCE: R2Bucket;
  METRICS: AnalyticsEngineDataset;

  JURISDICTION_ID?: string;
}
