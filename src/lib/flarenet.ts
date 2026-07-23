import type { Feature, Polygon } from "geojson";
import type { Incident, ProvenanceFact } from "./schemas";

export type FlarePriority = "p1" | "p2" | "res";

const RESOLVED_STATUSES: ReadonlySet<Incident["status"]> = new Set(["CLOSED", "RESOLVED"]);

/** Human labels for the incident lifecycle status. */
export const statusLabel: Record<Incident["status"], string> = {
  INTAKE: "Intake",
  NEEDS_REVIEW: "Needs review",
  CLAIMED: "Assigned",
  ACKNOWLEDGED: "Acknowledged",
  APPROVED: "Approved",
  DISPATCHING: "Dispatching",
  DISPATCHED: "Dispatched",
  RESOLVED: "Resolved",
  FAILED: "Failed",
  CLOSED: "Closed",
};

/** Collapse the console priority/status model into the mockup's P1 / P2 / Resolved buckets. */
export const flarePriority = (incident: Incident): FlarePriority => {
  if (RESOLVED_STATUSES.has(incident.status)) return "res";
  if (incident.priority === "CRITICAL") return "p1";
  return "p2";
};

export const priorityLabel: Record<FlarePriority, string> = {
  p1: "P1",
  p2: "P2",
  res: "RES",
};

export const priorityBadgeClass: Record<FlarePriority, string> = {
  p1: "b-p1",
  p2: "b-p2",
  res: "b-res",
};

export const priorityColor: Record<FlarePriority, string> = {
  p1: "#ff5843",
  p2: "#ffb02e",
  res: "#2fd39a",
};

/** Short headline for cards/tabs; falls back to the first clause of the summary. */
export const incidentTitle = (incident: Incident): string => {
  if (incident.title) return incident.title;
  const firstSentence = incident.summary.split(/[.;]/)[0]?.trim();
  return firstSentence && firstSentence.length <= 70 ? firstSentence : incident.summary.slice(0, 68).trim() + "…";
};

/** Provenance facts for the report view, synthesised from structured fields when absent. */
export const incidentFacts = (incident: Incident): ProvenanceFact[] => {
  if (incident.facts?.length) return incident.facts;
  const derived: ProvenanceFact[] = [];
  if (incident.peopleCount != null) {
    derived.push({ text: `${incident.peopleCount} occupant(s) reported at the scene.`, source: "911 CALLER" });
  }
  if (incident.injuries && incident.injuries !== "Not reported") {
    derived.push({ text: incident.injuries, source: "911 CALLER" });
  }
  incident.hazards.forEach((hazard) => derived.push({ text: hazard, source: "TRIAGE AI" }));
  if (!derived.length) derived.push({ text: incident.summary, source: "911 CALLER" });
  return derived;
};

export const incidentMissing = (incident: Incident): string | undefined => {
  if (incident.missingInfo) return incident.missingInfo;
  if (incident.missingFields.length) return incident.missingFields.join("; ");
  return undefined;
};

export interface DisplayResource {
  name: string;
  eta: string;
  onSite: boolean;
}

export const incidentResources = (incident: Incident): DisplayResource[] => {
  if (incident.assignedResources?.length) return incident.assignedResources;
  const resolved = flarePriority(incident) === "res";
  return incident.recommendation.units.map((name, index) => ({
    name,
    eta: resolved ? "ON SITE" : `ETA ${incident.recommendation.etaMinutes + index}m`,
    onSite: resolved,
  }));
};

export const proposedActionText = (incident: Incident): { text: string; unit: string } => {
  if (incident.proposedAction) return incident.proposedAction;
  return {
    text: incident.requestedResponse,
    unit: incident.recommendation.units[0] ?? incident.recommendation.agency,
  };
};

/** Format an ISO timestamp as a short 24h clock label (e.g. "14:31"). */
export const clockLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

export const clockLabelWithSeconds = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour12: false });

/**
 * Build a GeoJSON polygon approximating a geographic circle so flood zones scale
 * with the map (MapLibre circle layers use pixel radii, which would not).
 */
export const geoCirclePolygon = (
  center: [number, number],
  radiusMeters: number,
  points = 64,
): Feature<Polygon> => {
  const [lng, lat] = center;
  const earth = 6_378_137;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = (radiusMeters * Math.cos(angle)) / earth;
    const dy = (radiusMeters * Math.sin(angle)) / earth;
    const pointLng = lng + (dx * 180) / Math.PI / Math.cos((lat * Math.PI) / 180);
    const pointLat = lat + (dy * 180) / Math.PI;
    coords.push([pointLng, pointLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
};
