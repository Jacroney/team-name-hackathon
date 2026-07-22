CREATE TABLE IF NOT EXISTS incident_projection (
  incident_id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  category TEXT NOT NULL,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  incident_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS incident_projection_jurisdiction_updated
  ON incident_projection (jurisdiction_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS incident_audit (
  event_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  jurisdiction_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS incident_audit_incident_occurred
  ON incident_audit (incident_id, occurred_at DESC);
