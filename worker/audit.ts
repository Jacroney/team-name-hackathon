export interface AuditRow {
  incidentId: string;
  version: number;
  actor: string;
  action: string;
  detail?: string | null;
  jurisdictionId?: string | null;
}

export interface AuditRecord {
  incidentId: string;
  version: number;
  actor: string | null;
  action: string | null;
  detail: string | null;
  jurisdictionId: string | null;
  at: string;
}

let schemaReady = false;

/**
 * Ensure the audit table exists. Runs at most once per isolate. Best-effort:
 * failures are swallowed (logged) so callers never see an exception.
 */
export async function ensureAuditSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS incident_audit (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          incident_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          actor TEXT,
          action TEXT,
          detail TEXT,
          jurisdiction_id TEXT,
          at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      )
      .run();
    schemaReady = true;
  } catch (error) {
    console.warn("audit: ensureAuditSchema failed", error);
  }
}

/**
 * Append an immutable audit entry. Best-effort: never throws.
 */
export async function writeAudit(db: D1Database, row: AuditRow): Promise<void> {
  try {
    await ensureAuditSchema(db);
    await db
      .prepare(
        `INSERT INTO incident_audit
          (incident_id, version, actor, action, detail, jurisdiction_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.incidentId,
        row.version,
        row.actor,
        row.action,
        row.detail ?? null,
        row.jurisdictionId ?? null,
      )
      .run();
  } catch (error) {
    console.warn("audit: writeAudit failed", error);
  }
}

/**
 * Read the most recent audit entries for an incident. On error returns [].
 */
export async function readAudit(db: D1Database, incidentId: string): Promise<AuditRecord[]> {
  try {
    await ensureAuditSchema(db);
    const result = await db
      .prepare(
        `SELECT incident_id AS incidentId, version, actor, action, detail,
                jurisdiction_id AS jurisdictionId, at
         FROM incident_audit
         WHERE incident_id = ?
         ORDER BY seq DESC
         LIMIT 200`,
      )
      .bind(incidentId)
      .all<AuditRecord>();
    return result.results ?? [];
  } catch (error) {
    console.warn("audit: readAudit failed", error);
    return [];
  }
}
