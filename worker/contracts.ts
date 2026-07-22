import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jurisdictionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const channelSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["PHONE", "SMS", "WEB", "VOICE", "APP"]),
);

export const sosLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(100_000),
    address: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const evidenceReferenceSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    type: z.enum(["PHOTO", "AUDIO", "VIDEO", "DOCUMENT"]).optional(),
  })
  .strict();

export const sosRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(128),
    jurisdictionId: jurisdictionIdSchema,
    channel: channelSchema,
    text: z.string().trim().min(1).max(8_000),
    language: z.string().trim().min(2).max(35).optional(),
    location: sosLocationSchema.optional(),
    callerTimestamp: z.string().datetime({ offset: true }).optional(),
    accessibilityInformation: z.array(z.string().trim().min(1).max(256)).max(20).default([]),
    evidenceReferences: z.array(evidenceReferenceSchema).max(20).default([]),
    turnstileToken: z.string().min(1).max(2_048).optional(),
  })
  .strict();

export type SosRequest = z.infer<typeof sosRequestSchema>;

export const incidentRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    jurisdictionId: jurisdictionIdSchema,
    version: z.number().int().positive(),
    triageStatus: z.enum(["pending", "complete", "failed"]),
    geoStatus: z.enum(["pending", "complete", "failed"]),
    receivedAt: z.string().datetime({ offset: true }),
  })
  .catchall(jsonValueSchema);

export type IncidentRecord = z.infer<typeof incidentRecordSchema>;
export const incidentPatchSchema = z.record(z.string(), jsonValueSchema);
export type IncidentPatch = z.infer<typeof incidentPatchSchema>;

export type HubEventType =
  | "incident.created"
  | "incident.patch"
  | "incident.triage_failed"
  | "responder.online"
  | "responder.stale"
  | "responder.offline"
  | "system.degraded";

export interface HubEvent<T> {
  eventId: string;
  sequence: number;
  type: HubEventType;
  jurisdictionId: string;
  incidentId?: string;
  incidentVersion?: number;
  occurredAt: string;
  payload: T;
}

export interface HubSnapshot {
  type: "snapshot";
  jurisdictionId: string;
  sequence: number;
  generatedAt: string;
  incidents: IncidentRecord[];
  connectionStatuses: Array<{
    responderId: string;
    role: ConnectionRole;
    status: ConnectionStatus;
    updatedAt: string;
  }>;
}

export type ConnectionRole = "dispatcher" | "responder";
export type ConnectionStatus = "online" | "stale" | "offline";

export const hubPrincipalSchema = z
  .object({
    sub: z.string().min(1).max(128),
    role: z.enum(["dispatcher", "responder"]),
    jurisdictionId: jurisdictionIdSchema,
    exp: z.number().int().positive(),
  })
  .strict();

export type HubPrincipal = z.infer<typeof hubPrincipalSchema>;

export const triageResultSchema = z
  .object({
    severity: z.enum(["critical", "high", "medium", "low", "unknown"]),
    category: z.enum([
      "flood",
      "fire",
      "medical",
      "structural",
      "utility",
      "evacuation",
      "other",
    ]),
    summary: z.string().trim().min(1).max(1_000),
    immediateThreat: z.boolean(),
    peopleCount: z.number().int().nonnegative().nullable(),
    injuriesReported: z.boolean().nullable(),
    hazards: z.array(z.string().trim().min(1).max(200)).max(20),
    accessibilityNeeds: z.array(z.string().trim().min(1).max(200)).max(20),
    missingFields: z.array(z.string().trim().min(1).max(100)).max(20),
    evidence: z
      .array(
        z
          .object({
            messageId: z.string().trim().min(1).max(128),
            quote: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type TriageResult = z.infer<typeof triageResultSchema>;

export const geospatialAssessmentSchema = z
  .object({
    insideHazardZone: z.boolean(),
    hazardTypes: z.array(z.string().trim().min(1).max(100)).max(20),
    evacuationZone: z.string().trim().min(1).max(128).nullable(),
    nearestShelter: z
      .object({
        id: z.string().trim().min(1).max(128),
        distanceMeters: z.number().nonnegative().finite(),
        accessible: z.boolean(),
      })
      .strict()
      .nullable(),
    blockedRoadsNearby: z.number().int().nonnegative(),
    analysisVersion: z.string().trim().min(1).max(128),
  })
  .strict();

export type GeospatialAssessment = z.infer<typeof geospatialAssessmentSchema>;

export const recommendedReviewPrioritySchema = z
  .object({
    level: z.enum(["CRITICAL", "URGENT", "ROUTINE", "UNKNOWN"]),
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.string().min(1).max(200)).min(1).max(20),
    policyVersion: z.string().min(1).max(64),
    supportingEvidence: z
      .array(
        z
          .object({
            messageId: z.string().trim().min(1).max(128),
            quote: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type RecommendedReviewPriority = z.infer<typeof recommendedReviewPrioritySchema>;

const triageInputSchema = z
  .object({
    text: z.string().min(1).max(8_000),
    language: z.string().min(2).max(35).optional(),
    accessibilityInformation: z.array(z.string().min(1).max(256)).max(20),
    evidenceReferences: z.array(evidenceReferenceSchema).max(20),
  })
  .strict();

export const geoQueueMessageSchema = z
  .object({
    kind: z.literal("geo.assess"),
    schemaVersion: z.literal(1),
    incidentId: z.string().min(1).max(128),
    jurisdictionId: jurisdictionIdSchema,
    incidentVersion: z.number().int().positive(),
    receivedAt: z.string().datetime({ offset: true }),
    location: sosLocationSchema.nullable(),
    skipReason: z.enum(["location_unavailable", "feature_disabled"]).optional(),
    triageInput: triageInputSchema,
    enqueuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type GeoQueueMessage = z.infer<typeof geoQueueMessageSchema>;

export const triageQueueMessageSchema = z
  .object({
    kind: z.literal("ai.triage"),
    schemaVersion: z.literal(1),
    incidentId: z.string().min(1).max(128),
    jurisdictionId: jurisdictionIdSchema,
    incidentVersion: z.number().int().positive(),
    receivedAt: z.string().datetime({ offset: true }),
    location: sosLocationSchema.nullable(),
    triageInput: triageInputSchema,
    geospatialAssessment: geospatialAssessmentSchema.nullable(),
    promptVersion: z.string().min(1).max(64),
    model: z.string().min(1).max(200),
    priorityPolicyVersion: z.string().min(1).max(64),
    enqueuedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TriageQueueMessage = z.infer<typeof triageQueueMessageSchema>;
export type EnrichmentQueueMessage = GeoQueueMessage | TriageQueueMessage;
