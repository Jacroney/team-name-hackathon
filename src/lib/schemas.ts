import { z } from "zod";

export const prioritySchema = z.enum(["CRITICAL", "URGENT", "ROUTINE", "UNKNOWN"]);
export type Priority = z.infer<typeof prioritySchema>;

export const incidentStatusSchema = z.enum([
  "INTAKE",
  "NEEDS_REVIEW",
  "CLAIMED",
  "ACKNOWLEDGED",
  "APPROVED",
  "DISPATCHING",
  "DISPATCHED",
  "RESOLVED",
  "FAILED",
  "CLOSED",
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const incidentCategorySchema = z.enum([
  "MEDICAL",
  "FIRE",
  "POLICE",
  "RESCUE",
  "HAZMAT",
  "WELFARE",
  "OTHER",
]);
export type IncidentCategory = z.infer<typeof incidentCategorySchema>;

export const channelSchema = z.enum(["PHONE", "SMS", "WEB"]);
export type IncidentChannel = z.infer<typeof channelSchema>;

export const callerConnectionSchema = z.enum([
  "CONNECTED",
  "UNSTABLE",
  "DISCONNECTED",
  "ENDED",
]);
export type CallerConnection = z.infer<typeof callerConnectionSchema>;

export const transcriptMessageSchema = z.object({
  id: z.string(),
  speaker: z.enum(["CALLER", "AI", "OPERATOR"]),
  original: z.string(),
  translated: z.string().optional(),
  language: z.string().optional(),
  timestamp: z.string().datetime(),
  factIds: z.array(z.string()).default([]),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  type: z.enum(["PHOTO", "AUDIO", "VIDEO", "DOCUMENT"]),
  label: z.string(),
  timestamp: z.string().datetime(),
  url: z.string().url().optional(),
  durationSeconds: z.number().nonnegative().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const activitySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  actor: z.string(),
  action: z.string(),
  detail: z.string().optional(),
});
export type Activity = z.infer<typeof activitySchema>;

export const locationSchema = z.object({
  address: z.string(),
  district: z.string(),
  coordinates: z.tuple([z.number(), z.number()]),
});

export const recommendationSchema = z.object({
  agency: z.string(),
  units: z.array(z.string()),
  etaMinutes: z.number().int().nonnegative(),
  rationale: z.string(),
});

// Flare Net presentation fields (optional so realtime patches + API still parse).
export const provenanceFactSchema = z.object({
  text: z.string(),
  source: z.string(),
});
export type ProvenanceFact = z.infer<typeof provenanceFactSchema>;

export const assignedResourceSchema = z.object({
  name: z.string(),
  eta: z.string(),
  onSite: z.boolean().default(false),
});
export type AssignedResource = z.infer<typeof assignedResourceSchema>;

export const proposedActionSchema = z.object({
  text: z.string(),
  unit: z.string(),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const incidentSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  category: incidentCategorySchema,
  priority: prioritySchema,
  status: incidentStatusSchema,
  summary: z.string(),
  location: locationSchema,
  channel: channelSchema,
  callerConnection: callerConnectionSchema,
  peopleCount: z.number().int().nonnegative().nullable(),
  injuries: z.string(),
  hazards: z.array(z.string()),
  accessibilityNeeds: z.array(z.string()),
  destinationAgency: z.string(),
  requestedResponse: z.string(),
  missingFields: z.array(z.string()),
  claimedBy: z.string().nullable(),
  viewers: z.array(z.string()),
  receivedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  transcript: z.array(transcriptMessageSchema),
  evidence: z.array(evidenceSchema),
  activity: z.array(activitySchema),
  recommendation: recommendationSchema,
  failureReason: z.string().optional(),
  // Flare Net presentation fields.
  title: z.string().optional(),
  facts: z.array(provenanceFactSchema).optional(),
  assignedResources: z.array(assignedResourceSchema).optional(),
  proposedAction: proposedActionSchema.optional(),
  missingInfo: z.string().optional(),
  floodRadiusMeters: z.number().nonnegative().optional(),
  detailLabel: z.string().optional(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentListSchema = z.array(incidentSchema);

export const dispatchDraftSchema = z.object({
  category: incidentCategorySchema,
  priority: prioritySchema,
  address: z.string().min(1),
  peopleCount: z.number().int().nonnegative().nullable(),
  injuries: z.string(),
  hazards: z.array(z.string()),
  accessibilityNeeds: z.array(z.string()),
  destinationAgency: z.string().min(1),
  requestedResponse: z.string().min(1),
});
export type DispatchDraft = z.infer<typeof dispatchDraftSchema>;

export const incidentPatchSchema = z.object({
  type: z.literal("incident.patch"),
  incidentId: z.string(),
  version: z.number().int().positive(),
  patch: incidentSchema.partial().omit({ id: true, version: true }),
});

export const realtimeEventSchema = z.discriminatedUnion("type", [
  incidentPatchSchema,
  z.object({ type: z.literal("incident.created"), incident: incidentSchema }),
  z.object({
    type: z.literal("presence"),
    incidentId: z.string(),
    viewers: z.array(z.string()),
  }),
  z.object({ type: z.literal("heartbeat"), timestamp: z.string().datetime() }),
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
