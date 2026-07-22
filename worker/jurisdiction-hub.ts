import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { getHeartbeatConfig } from "./config";
import {
  incidentRecordSchema,
  incidentPatchSchema,
  jurisdictionIdSchema,
  type ConnectionRole,
  type ConnectionStatus,
  type HubEvent,
  type HubEventType,
  type HubSnapshot,
} from "./contracts";
import { recordMetric } from "./metrics";

const MAX_RECENT_EVENTS = 1_000;
const MAX_CLIENT_MESSAGE_BYTES = 4_096;
const MAX_MALFORMED_MESSAGES = 3;
const MAX_SEND_FAILURES = 2;
const IDEMPOTENCY_PENDING_TIMEOUT_MS = 30_000;

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }).strict(),
  z
    .object({
      type: z.literal("incident.viewed"),
      incidentId: z.string().min(1).max(128),
    })
    .strict(),
]);

interface ConnectionAttachment {
  connectionId: string;
  responderId: string;
  role: ConnectionRole;
  jurisdictionId: string;
  lastHeartbeatAt: number;
  malformedMessages: number;
  sendFailures: number;
}

type HubStateRow = { jurisdiction_id: string; sequence: number };
type EventRow = { event_json: string };
type IncidentRow = { incident_json: string; version: number; received_at_ms: number };
type IdempotencyRow = {
  request_hash: string;
  status: string;
  incident_json: string | null;
  updated_at_ms: number;
};
type ConnectionRow = {
  connection_id: string;
  responder_id: string;
  role: ConnectionRole;
  status: ConnectionStatus;
  last_heartbeat_ms: number;
};
type ResponderRow = {
  responder_id: string;
  role: ConnectionRole;
  status: ConnectionStatus;
  updated_at_ms: number;
};
type CountRow = { total: number };

export class JurisdictionHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS hub_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          jurisdiction_id TEXT NOT NULL,
          sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          event_json TEXT NOT NULL,
          occurred_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS incidents (
          incident_id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          received_at_ms INTEGER NOT NULL,
          incident_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS idempotency_records (
          idempotency_key TEXT PRIMARY KEY,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          incident_id TEXT,
          incident_json TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS connections (
          connection_id TEXT PRIMARY KEY,
          responder_id TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          last_heartbeat_ms INTEGER NOT NULL,
          connected_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS connections_responder_idx
          ON connections (responder_id, status);
        CREATE TABLE IF NOT EXISTS responders (
          responder_id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS first_views (
          incident_id TEXT PRIMARY KEY,
          responder_id TEXT NOT NULL,
          viewed_at_ms INTEGER NOT NULL
        );
      `);
    });
  }

  private ensureJurisdiction(jurisdictionId: string): HubStateRow {
    const parsedId = jurisdictionIdSchema.parse(jurisdictionId);
    const state = this.ctx.storage.sql
      .exec<HubStateRow>("SELECT jurisdiction_id, sequence FROM hub_state WHERE singleton = 1")
      .toArray()[0];
    if (!state) {
      this.ctx.storage.sql.exec(
        "INSERT INTO hub_state (singleton, jurisdiction_id, sequence) VALUES (1, ?, 0)",
        parsedId,
      );
      return { jurisdiction_id: parsedId, sequence: 0 };
    }
    if (state.jurisdiction_id !== parsedId) throw new Error("Jurisdiction routing mismatch");
    return state;
  }

  private state(): HubStateRow {
    const state = this.ctx.storage.sql
      .exec<HubStateRow>("SELECT jurisdiction_id, sequence FROM hub_state WHERE singleton = 1")
      .toArray()[0];
    if (!state) throw new Error("Jurisdiction hub is not initialized");
    return state;
  }

  private createEvent<T>(input: {
    type: HubEventType;
    payload: T;
    incidentId?: string;
    incidentVersion?: number;
    inTransaction?: () => void;
  }): HubEvent<T> {
    return this.ctx.storage.transactionSync(() => {
      const state = this.state();
      const sequence = state.sequence + 1;
      const event: HubEvent<T> = {
        eventId: crypto.randomUUID(),
        sequence,
        type: input.type,
        jurisdictionId: state.jurisdiction_id,
        incidentId: input.incidentId,
        incidentVersion: input.incidentVersion,
        occurredAt: new Date().toISOString(),
        payload: input.payload,
      };

      input.inTransaction?.();
      this.ctx.storage.sql.exec(
        "UPDATE hub_state SET sequence = ? WHERE singleton = 1",
        sequence,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO events (sequence, event_id, event_json, occurred_at_ms) VALUES (?, ?, ?, ?)",
        sequence,
        event.eventId,
        JSON.stringify(event),
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM events WHERE sequence <= ?",
        sequence - MAX_RECENT_EVENTS,
      );
      return event;
    });
  }

  private attachment(ws: WebSocket): ConnectionAttachment | null {
    const value = ws.deserializeAttachment() as Partial<ConnectionAttachment> | null;
    if (
      !value ||
      typeof value.connectionId !== "string" ||
      typeof value.responderId !== "string" ||
      (value.role !== "dispatcher" && value.role !== "responder") ||
      typeof value.jurisdictionId !== "string" ||
      typeof value.lastHeartbeatAt !== "number"
    ) {
      return null;
    }
    return {
      connectionId: value.connectionId,
      responderId: value.responderId,
      role: value.role,
      jurisdictionId: value.jurisdictionId,
      lastHeartbeatAt: value.lastHeartbeatAt,
      malformedMessages: value.malformedMessages ?? 0,
      sendFailures: value.sendFailures ?? 0,
    };
  }

  private safeSend(ws: WebSocket, message: string): boolean {
    try {
      ws.send(message);
      return true;
    } catch {
      const attachment = this.attachment(ws);
      if (!attachment) {
        ws.close(1011, "Connection state unavailable");
        return false;
      }
      attachment.sendFailures += 1;
      ws.serializeAttachment(attachment);
      if (attachment.sendFailures >= MAX_SEND_FAILURES) ws.close(1013, "Client is not keeping up");
      return false;
    }
  }

  private fanout(event: HubEvent<unknown>): void {
    const serialized = JSON.stringify(event);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (this.safeSend(socket, serialized)) delivered += 1;
    }
    recordMetric(this.env.METRICS, "websocket.broadcast_fanout", {
      jurisdictionId: event.jurisdictionId,
      value: delivered,
      pipeline: "realtime",
    });
  }

  private activeConnectionCount(): number {
    return this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS total FROM connections WHERE status != 'offline'")
      .toArray()[0]?.total ?? 0;
  }

  private recordActiveConnections(jurisdictionId: string): void {
    recordMetric(this.env.METRICS, "websocket.active_connections", {
      jurisdictionId,
      value: this.activeConnectionCount(),
      pipeline: "realtime",
    });
  }

  private updateResponderAggregate(responderId: string): void {
    const counts = this.ctx.storage.sql
      .exec<{ online: number; stale: number }>(
        `SELECT
           SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online,
           SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS stale
         FROM connections WHERE responder_id = ?`,
        responderId,
      )
      .toArray()[0] ?? { online: 0, stale: 0 };
    const nextStatus: ConnectionStatus =
      counts.online > 0 ? "online" : counts.stale > 0 ? "stale" : "offline";
    const current = this.ctx.storage.sql
      .exec<ResponderRow>(
        "SELECT responder_id, role, status, updated_at_ms FROM responders WHERE responder_id = ?",
        responderId,
      )
      .toArray()[0];
    const connection = this.ctx.storage.sql
      .exec<{ role: ConnectionRole }>(
        "SELECT role FROM connections WHERE responder_id = ? ORDER BY connected_at_ms DESC LIMIT 1",
        responderId,
      )
      .toArray()[0];
    if (!connection) return;
    if (current?.status === nextStatus) return;

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO responders (responder_id, role, status, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(responder_id) DO UPDATE SET
         role = excluded.role,
         status = excluded.status,
         updated_at_ms = excluded.updated_at_ms`,
      responderId,
      connection.role,
      nextStatus,
      now,
    );
    const event = this.createEvent({
      type: `responder.${nextStatus}`,
      payload: { responderId, role: connection.role, connectionStatus: nextStatus },
    });
    this.fanout(event);
  }

  private recoverSocket(ws: WebSocket, lastSequence: number | null): void {
    const state = this.state();
    if (lastSequence === null) {
      this.sendSnapshot(ws, state);
      return;
    }
    if (lastSequence > state.sequence) {
      ws.close(1008, "lastSequence is ahead of the hub");
      return;
    }

    const oldest = this.ctx.storage.sql
      .exec<{ sequence: number }>("SELECT MIN(sequence) AS sequence FROM events")
      .toArray()[0]?.sequence;
    const replayAvailable =
      lastSequence === state.sequence ||
      (typeof oldest === "number" && lastSequence >= oldest - 1);
    if (!replayAvailable) {
      this.sendSnapshot(ws, state);
      return;
    }

    const events = this.ctx.storage.sql
      .exec<EventRow>(
        "SELECT event_json FROM events WHERE sequence > ? ORDER BY sequence ASC",
        lastSequence,
      )
      .toArray();
    for (const event of events) {
      if (!this.safeSend(ws, event.event_json)) return;
    }
    this.safeSend(
      ws,
      JSON.stringify({ type: "replay.complete", jurisdictionId: state.jurisdiction_id, sequence: state.sequence }),
    );
  }

  private sendSnapshot(ws: WebSocket, state: HubStateRow): void {
    const incidents = this.ctx.storage.sql
      .exec<IncidentRow>(
        "SELECT incident_json, version, received_at_ms FROM incidents ORDER BY received_at_ms DESC",
      )
      .toArray()
      .map((row) => incidentRecordSchema.parse(JSON.parse(row.incident_json)));
    const connectionStatuses = this.ctx.storage.sql
      .exec<ResponderRow>(
        "SELECT responder_id, role, status, updated_at_ms FROM responders ORDER BY responder_id",
      )
      .toArray()
      .map((row) => ({
        responderId: row.responder_id,
        role: row.role,
        status: row.status,
        updatedAt: new Date(row.updated_at_ms).toISOString(),
      }));
    const snapshot: HubSnapshot = {
      type: "snapshot",
      jurisdictionId: state.jurisdiction_id,
      sequence: state.sequence,
      generatedAt: new Date().toISOString(),
      incidents,
      connectionStatuses,
    };
    this.safeSend(ws, JSON.stringify(snapshot));
  }

  private async ensureSweepAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      const state = this.state();
      const config = await getHeartbeatConfig(this.env, state.jurisdiction_id);
      await this.ctx.storage.setAlarm(Date.now() + config.sweepEverySeconds * 1_000);
    }
  }

  async reserveSos(
    jurisdictionId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<
    | { status: "reserved" }
    | { status: "pending" }
    | { status: "complete"; incidentJson: string }
    | { status: "conflict" }
  > {
    this.ensureJurisdiction(jurisdictionId);
    const existing = this.ctx.storage.sql
      .exec<IdempotencyRow>(
        `SELECT request_hash, status, incident_json, updated_at_ms
         FROM idempotency_records WHERE idempotency_key = ?`,
        idempotencyKey,
      )
      .toArray()[0];
    if (existing) {
      if (existing.request_hash !== requestHash) return { status: "conflict" };
      if (existing.status === "complete" && existing.incident_json) {
        return {
          status: "complete",
          incidentJson: existing.incident_json,
        };
      }
      if (
        existing.status === "pending" &&
        Date.now() - existing.updated_at_ms < IDEMPOTENCY_PENDING_TIMEOUT_MS
      ) {
        return { status: "pending" };
      }
      this.ctx.storage.sql.exec(
        "UPDATE idempotency_records SET status = 'pending', updated_at_ms = ? WHERE idempotency_key = ?",
        Date.now(),
        idempotencyKey,
      );
      return { status: "reserved" };
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO idempotency_records
       (idempotency_key, request_hash, status, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'pending', ?, ?)`,
      idempotencyKey,
      requestHash,
      now,
      now,
    );
    return { status: "reserved" };
  }

  async getSosResultJson(
    jurisdictionId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<string | null> {
    this.ensureJurisdiction(jurisdictionId);
    const row = this.ctx.storage.sql
      .exec<IdempotencyRow>(
        `SELECT request_hash, status, incident_json, updated_at_ms
         FROM idempotency_records WHERE idempotency_key = ?`,
        idempotencyKey,
      )
      .toArray()[0];
    if (row?.request_hash !== requestHash || row.status !== "complete" || !row.incident_json) {
      return null;
    }
    return row.incident_json;
  }

  async markSosAttemptFailed(
    jurisdictionId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    this.ensureJurisdiction(jurisdictionId);
    this.ctx.storage.sql.exec(
      `UPDATE idempotency_records SET status = 'failed', updated_at_ms = ?
       WHERE idempotency_key = ? AND request_hash = ? AND status = 'pending'`,
      Date.now(),
      idempotencyKey,
      requestHash,
    );
  }

  async completeSos(
    jurisdictionId: string,
    idempotencyKey: string,
    requestHash: string,
    rawIncidentJson: string,
  ): Promise<{ incidentJson: string; deduplicated: boolean }> {
    this.ensureJurisdiction(jurisdictionId);
    const incident = incidentRecordSchema.parse(JSON.parse(rawIncidentJson));
    if (incident.jurisdictionId !== jurisdictionId) throw new Error("Incident jurisdiction mismatch");
    const reservation = this.ctx.storage.sql
      .exec<IdempotencyRow>(
        `SELECT request_hash, status, incident_json, updated_at_ms
         FROM idempotency_records WHERE idempotency_key = ?`,
        idempotencyKey,
      )
      .toArray()[0];
    if (
      reservation?.request_hash === requestHash &&
      reservation.status === "complete" &&
      reservation.incident_json
    ) {
      return {
        incidentJson: reservation.incident_json,
        deduplicated: true,
      };
    }
    if (!reservation || reservation.request_hash !== requestHash) {
      throw new Error("SOS idempotency reservation is unavailable");
    }

    const incidentJson = JSON.stringify(incident);
    const receivedAt = Date.parse(incident.receivedAt);
    const event = this.createEvent({
      type: "incident.created",
      incidentId: incident.id,
      incidentVersion: incident.version,
      payload: { incident },
      inTransaction: () => {
        this.ctx.storage.sql.exec(
          `INSERT INTO incidents (incident_id, version, received_at_ms, incident_json)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(incident_id) DO UPDATE SET
             version = excluded.version,
             received_at_ms = excluded.received_at_ms,
             incident_json = excluded.incident_json`,
          incident.id,
          incident.version,
          receivedAt,
          incidentJson,
        );
        this.ctx.storage.sql.exec(
          `UPDATE idempotency_records SET
             status = 'complete', incident_id = ?, incident_json = ?, updated_at_ms = ?
           WHERE idempotency_key = ? AND request_hash = ?`,
          incident.id,
          incidentJson,
          Date.now(),
          idempotencyKey,
          requestHash,
        );
      },
    });
    this.fanout(event);
    return { incidentJson, deduplicated: false };
  }

  async publishIncidentUpdate(
    jurisdictionId: string,
    expectedVersion: number,
    updatedIncidentJson: string,
    patchJson: string,
    type: "incident.patch" | "incident.triage_failed" = "incident.patch",
  ): Promise<{ status: "published"; sequence: number } | { status: "stale"; currentVersion: number }> {
    this.ensureJurisdiction(jurisdictionId);
    const incident = incidentRecordSchema.parse(JSON.parse(updatedIncidentJson));
    const patch = incidentPatchSchema.parse(JSON.parse(patchJson));
    if (incident.jurisdictionId !== jurisdictionId) throw new Error("Incident jurisdiction mismatch");
    const current = this.ctx.storage.sql
      .exec<IncidentRow>(
        "SELECT incident_json, version, received_at_ms FROM incidents WHERE incident_id = ?",
        incident.id,
      )
      .toArray()[0];
    if (!current) throw new Error("Incident snapshot is unavailable");
    if (current.version !== expectedVersion) {
      return { status: "stale", currentVersion: current.version };
    }
    if (incident.version !== expectedVersion + 1) throw new Error("Out-of-order incident patch");

    const event = this.createEvent({
      type,
      incidentId: incident.id,
      incidentVersion: incident.version,
      payload: { patch },
      inTransaction: () => {
        this.ctx.storage.sql.exec(
          "UPDATE incidents SET version = ?, incident_json = ? WHERE incident_id = ? AND version = ?",
          incident.version,
          JSON.stringify(incident),
          incident.id,
          expectedVersion,
        );
      },
    });
    this.fanout(event);
    return { status: "published", sequence: event.sequence };
  }

  async publishSystemDegraded(
    jurisdictionId: string,
    component: "ai" | "geo" | "queue" | "incident-service",
  ): Promise<void> {
    this.ensureJurisdiction(jurisdictionId);
    const event = this.createEvent({
      type: "system.degraded",
      payload: { component },
    });
    this.fanout(event);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const jurisdictionId = request.headers.get("X-CM-Jurisdiction");
    const responderId = request.headers.get("X-CM-Principal");
    const role = request.headers.get("X-CM-Role");
    if (
      !jurisdictionId ||
      !responderId ||
      responderId.length > 128 ||
      (role !== "dispatcher" && role !== "responder")
    ) {
      return new Response("Invalid realtime principal", { status: 401 });
    }
    const state = this.ensureJurisdiction(jurisdictionId);
    const existingRole = this.ctx.storage.sql
      .exec<{ role: ConnectionRole }>("SELECT role FROM responders WHERE responder_id = ?", responderId)
      .toArray()[0]?.role;
    if (existingRole && existingRole !== role) {
      return new Response("Realtime role does not match existing principal", { status: 409 });
    }

    const url = new URL(request.url);
    const rawLastSequence = url.searchParams.get("lastSequence");
    const lastSequence = rawLastSequence === null ? null : Number(rawLastSequence);
    if (lastSequence !== null && (!Number.isSafeInteger(lastSequence) || lastSequence < 0)) {
      return new Response("lastSequence must be a non-negative integer", { status: 400 });
    }

    const previousConnections = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS total FROM connections WHERE responder_id = ?", responderId)
      .toArray()[0]?.total ?? 0;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const now = Date.now();
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      responderId,
      role,
      jurisdictionId,
      lastHeartbeatAt: now,
      malformedMessages: 0,
      sendFailures: 0,
    };
    this.ctx.acceptWebSocket(server, [`role:${role}`]);
    server.serializeAttachment(attachment);
    this.ctx.storage.sql.exec(
      `INSERT INTO connections
       (connection_id, responder_id, role, status, last_heartbeat_ms, connected_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'online', ?, ?, ?)`,
      attachment.connectionId,
      responderId,
      role,
      now,
      now,
      now,
    );

    this.recoverSocket(server, lastSequence);
    this.updateResponderAggregate(responderId);
    this.recordActiveConnections(state.jurisdiction_id);
    if (previousConnections > 0 || lastSequence !== null) {
      recordMetric(this.env.METRICS, "websocket.reconnections", {
        jurisdictionId,
        pipeline: "realtime",
      });
    }
    await this.ensureSweepAlarm();

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "crisis-mesh" },
    });
  }

  private malformedMessage(ws: WebSocket): void {
    const attachment = this.attachment(ws);
    if (!attachment) {
      ws.close(1008, "Connection state unavailable");
      return;
    }
    attachment.malformedMessages += 1;
    ws.serializeAttachment(attachment);
    if (attachment.malformedMessages >= MAX_MALFORMED_MESSAGES) {
      ws.close(1008, "Too many malformed messages");
      return;
    }
    this.safeSend(ws, JSON.stringify({ type: "error", code: "malformed_message" }));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      this.malformedMessage(ws);
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.malformedMessage(ws);
      return;
    }
    const parsed = clientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.malformedMessage(ws);
      return;
    }
    await this.handleClientMessage(ws, parsed.data);
  }

  private async handleClientMessage(
    ws: WebSocket,
    message: z.infer<typeof clientMessageSchema>,
  ): Promise<void> {
    const attachment = this.attachment(ws);
    if (!attachment) {
      ws.close(1008, "Connection state unavailable");
      return;
    }
    if (message.type === "heartbeat") {
      const now = Date.now();
      const connection = this.ctx.storage.sql
        .exec<ConnectionRow>(
          `SELECT connection_id, responder_id, role, status, last_heartbeat_ms
           FROM connections WHERE connection_id = ?`,
          attachment.connectionId,
        )
        .toArray()[0];
      if (!connection || connection.status === "offline") {
        ws.close(1008, "Connection is offline");
        return;
      }
      this.ctx.storage.sql.exec(
        `UPDATE connections SET status = 'online', last_heartbeat_ms = ?, updated_at_ms = ?
         WHERE connection_id = ?`,
        now,
        now,
        attachment.connectionId,
      );
      attachment.lastHeartbeatAt = now;
      attachment.sendFailures = 0;
      ws.serializeAttachment(attachment);
      this.updateResponderAggregate(attachment.responderId);
      this.safeSend(
        ws,
        JSON.stringify({ type: "heartbeat.ack", serverTime: new Date(now).toISOString(), sequence: this.state().sequence }),
      );
      await this.ensureSweepAlarm();
      return;
    }

    if (attachment.role !== "dispatcher") {
      this.malformedMessage(ws);
      return;
    }
    const alreadyViewed = this.ctx.storage.sql
      .exec<{ incident_id: string }>("SELECT incident_id FROM first_views WHERE incident_id = ?", message.incidentId)
      .toArray()[0];
    if (alreadyViewed) return;
    const incident = this.ctx.storage.sql
      .exec<IncidentRow>(
        "SELECT incident_json, version, received_at_ms FROM incidents WHERE incident_id = ?",
        message.incidentId,
      )
      .toArray()[0];
    if (!incident) return;
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO first_views (incident_id, responder_id, viewed_at_ms) VALUES (?, ?, ?)",
      message.incidentId,
      attachment.responderId,
      now,
    );
    recordMetric(this.env.METRICS, "dispatcher.time_to_first_view_ms", {
      jurisdictionId: attachment.jurisdictionId,
      value: Math.max(0, now - incident.received_at_ms),
      pipeline: "realtime",
    });
  }

  private disconnect(ws: WebSocket): void {
    const attachment = this.attachment(ws);
    if (!attachment) return;
    this.ctx.storage.sql.exec(
      "UPDATE connections SET status = 'offline', updated_at_ms = ? WHERE connection_id = ?",
      Date.now(),
      attachment.connectionId,
    );
    this.updateResponderAggregate(attachment.responderId);
    this.recordActiveConnections(attachment.jurisdictionId);
  }

  webSocketClose(ws: WebSocket): void {
    this.disconnect(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.disconnect(ws);
    ws.close(1011, "Realtime connection failed");
  }

  async alarm(): Promise<void> {
    const state = this.state();
    const config = await getHeartbeatConfig(this.env, state.jurisdiction_id);
    const now = Date.now();
    const affectedResponders = new Set<string>();
    const sockets = new Map<string, WebSocket>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment) sockets.set(attachment.connectionId, socket);
    }

    const connections = this.ctx.storage.sql
      .exec<ConnectionRow>(
        `SELECT connection_id, responder_id, role, status, last_heartbeat_ms
         FROM connections WHERE status != 'offline'`,
      )
      .toArray();
    for (const connection of connections) {
      const elapsed = now - connection.last_heartbeat_ms;
      const nextStatus: ConnectionStatus =
        elapsed >= config.offlineAfterSeconds * 1_000
          ? "offline"
          : elapsed >= config.staleAfterSeconds * 1_000
            ? "stale"
            : "online";
      if (nextStatus === connection.status) continue;
      this.ctx.storage.sql.exec(
        "UPDATE connections SET status = ?, updated_at_ms = ? WHERE connection_id = ?",
        nextStatus,
        now,
        connection.connection_id,
      );
      affectedResponders.add(connection.responder_id);
      recordMetric(this.env.METRICS, "websocket.heartbeat_expirations", {
        jurisdictionId: state.jurisdiction_id,
        outcome: nextStatus,
        pipeline: "realtime",
      });
      const socket = sockets.get(connection.connection_id);
      if (socket && nextStatus === "offline") socket.close(4001, "Heartbeat timeout");
    }

    for (const responderId of affectedResponders) this.updateResponderAggregate(responderId);
    this.ctx.storage.sql.exec(
      "DELETE FROM connections WHERE status = 'offline' AND updated_at_ms < ?",
      now - 24 * 60 * 60 * 1_000,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM idempotency_records WHERE updated_at_ms < ?",
      now - 7 * 24 * 60 * 60 * 1_000,
    );
    this.recordActiveConnections(state.jurisdiction_id);

    if (this.activeConnectionCount() > 0) {
      await this.ctx.storage.setAlarm(now + config.sweepEverySeconds * 1_000);
    }
  }
}
