import type { IncidentRecord } from "./contracts";

export async function projectIncident(env: Env, incident: IncidentRecord): Promise<void> {
  await env.OPERATIONS_DB.prepare(
    `INSERT INTO incident_projection
     (incident_id, jurisdiction_id, status, priority, category, received_at, updated_at, incident_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(incident_id) DO UPDATE SET
       status = excluded.status, priority = excluded.priority, category = excluded.category,
       updated_at = excluded.updated_at, incident_json = excluded.incident_json`,
  )
    .bind(
      incident.id,
      incident.jurisdictionId,
      String(incident.status ?? "INTAKE"),
      String(incident.priority ?? "UNKNOWN"),
      String(incident.category ?? "OTHER"),
      incident.receivedAt,
      String(incident.updatedAt ?? incident.receivedAt),
      JSON.stringify(incident),
    )
    .run();
}

export async function recordAudit(
  env: Env,
  input: { incidentId: string; jurisdictionId: string; type: string; payload: unknown },
): Promise<void> {
  const event = {
    eventId: crypto.randomUUID(),
    incidentId: input.incidentId,
    jurisdictionId: input.jurisdictionId,
    type: input.type,
    occurredAt: new Date().toISOString(),
    payload: input.payload,
  };
  await Promise.all([
    env.OPERATIONS_DB.prepare(
      `INSERT INTO incident_audit (event_id, incident_id, jurisdiction_id, event_type, occurred_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(event.eventId, event.incidentId, event.jurisdictionId, event.type, event.occurredAt, JSON.stringify(event.payload))
      .run(),
    env.AUDIT_EVENTS.send([event]),
  ]);
}

export async function recordIncidentChange(
  env: Env,
  incident: IncidentRecord,
  type: string,
): Promise<void> {
  try {
    await Promise.all([
      projectIncident(env, incident),
      recordAudit(env, {
        incidentId: incident.id,
        jurisdictionId: incident.jurisdictionId,
        type,
        payload: incident,
      }),
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "incident projection failed",
        type,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
