import type { Env } from "./env";

/**
 * BE1 data layer — the durable side-effects of the incident system-of-record.
 * All helpers are defensive: a failure here must never break a mutation, so
 * every call is best-effort and logged rather than thrown.
 */

export interface AuditRow {
  incidentId: string;
  version: number;
  actor: string;
  action: string;
  detail?: string;
  category: string;
  priority: string;
  status: string;
}

let schemaReady = false;

/** Idempotent D1 schema creation. Runs once per isolate. */
export const ensureAuditSchema = async (env: Env): Promise<void> => {
  if (schemaReady) return;
  await env.AUDIT_DB.exec(
    "CREATE TABLE IF NOT EXISTS incident_audit (" +
      "seq INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "incident_id TEXT NOT NULL, " +
      "version INTEGER NOT NULL, " +
      "actor TEXT NOT NULL, " +
      "action TEXT NOT NULL, " +
      "detail TEXT, " +
      "category TEXT, " +
      "priority TEXT, " +
      "status TEXT, " +
      "at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  schemaReady = true;
};

/** Append an immutable audit entry for an incident mutation. */
export const writeAudit = async (env: Env, row: AuditRow): Promise<void> => {
  try {
    await ensureAuditSchema(env);
    await env.AUDIT_DB.prepare(
      "INSERT INTO incident_audit " +
        "(incident_id, version, actor, action, detail, category, priority, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        row.incidentId,
        row.version,
        row.actor,
        row.action,
        row.detail ?? null,
        row.category,
        row.priority,
        row.status,
      )
      .run();
  } catch (error) {
    console.warn("audit write failed", error);
  }
};

/** Read the audit trail for one incident, newest first. */
export const readAudit = async (env: Env, incidentId: string): Promise<unknown[]> => {
  try {
    await ensureAuditSchema(env);
    const { results } = await env.AUDIT_DB.prepare(
      "SELECT incident_id AS incidentId, version, actor, action, detail, " +
        "category, priority, status, at FROM incident_audit " +
        "WHERE incident_id = ? ORDER BY seq DESC LIMIT 200",
    )
      .bind(incidentId)
      .all();
    return results ?? [];
  } catch (error) {
    console.warn("audit read failed", error);
    return [];
  }
};

/** Emit a metric datapoint for dashboards (fire-and-forget). */
export const recordMetric = (env: Env, row: AuditRow): void => {
  try {
    env.METRICS.writeDataPoint({
      blobs: [row.incidentId, row.action, row.category, row.priority, row.status, row.actor],
      doubles: [row.version],
      indexes: [row.category],
    });
  } catch (error) {
    console.warn("metric write failed", error);
  }
};

/* --------------------------------------------------------------------------
 * KV — jurisdiction reference data (agency directory + districts). Seeded on
 * first read so a fresh namespace is immediately usable.
 * ------------------------------------------------------------------------ */

export interface JurisdictionConfig {
  jurisdictionId: string;
  agencies: string[];
  districts: string[];
  updatedAt: string;
}

const CONFIG_KEY = (jurisdiction: string): string => `jurisdiction:${jurisdiction}`;

const DEFAULT_CONFIG = (jurisdiction: string): JurisdictionConfig => ({
  jurisdictionId: jurisdiction,
  agencies: [
    "Chicago Fire Department",
    "Chicago Fire Department EMS",
    "Chicago Police Department",
    "Metro Emergency Communications",
    "Illinois State Police",
    "Regional HazMat Team",
  ],
  districts: ["North", "Central", "South", "West", "Lakefront"],
  updatedAt: new Date().toISOString(),
});

export const getJurisdictionConfig = async (
  env: Env,
  jurisdiction: string,
): Promise<JurisdictionConfig> => {
  const existing = await env.CONFIG.get<JurisdictionConfig>(CONFIG_KEY(jurisdiction), "json");
  if (existing) return existing;
  const seeded = DEFAULT_CONFIG(jurisdiction);
  await env.CONFIG.put(CONFIG_KEY(jurisdiction), JSON.stringify(seeded));
  return seeded;
};
