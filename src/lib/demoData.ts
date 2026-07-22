import {
  incidentListSchema,
  type AssignedResource,
  type Incident,
  type ProvenanceFact,
} from "./schemas";

const now = Date.now();
const isoMinutesAgo = (minutes: number, secondsOffset = 0): string =>
  new Date(now - minutes * 60_000 + secondsOffset * 1_000).toISOString();

interface FloodSeed {
  id: string;
  priority: Incident["priority"];
  category: Incident["category"];
  status?: Incident["status"];
  minutesAgo: number;
  dispatchedMinutesAgo?: number;
  title: string;
  address: string;
  district: string;
  /** [lat, lng] as read from the map mockup; converted to [lng, lat] for the schema. */
  latLng: [number, number];
  summary: string;
  channel: Incident["channel"];
  callerConnection: Incident["callerConnection"];
  caller: string;
  peopleCount?: number | null;
  injuries?: string;
  hazards?: string[];
  accessibilityNeeds?: string[];
  missingInfo?: string;
  missingFields?: string[];
  destinationAgency: string;
  requestedResponse: string;
  rationale: string;
  facts: ProvenanceFact[];
  resources: AssignedResource[];
  proposedAction: { text: string; unit: string };
  auditExtra?: { minutesAgo: number; actor: string; action: string; detail?: string }[];
  floodRadiusMeters?: number;
  detailLabel: string;
  failureReason?: string;
}

const makeFloodIncident = (seed: FloodSeed): Incident => {
  const receivedAt = isoMinutesAgo(seed.minutesAgo);
  const dispatchedAt = isoMinutesAgo(seed.dispatchedMinutesAgo ?? Math.max(seed.minutesAgo - 2, 0));
  const [lat, lng] = seed.latLng;

  const activity = [
    {
      id: `${seed.id}-a1`,
      timestamp: receivedAt,
      actor: "Flare Net",
      action: "Incident intake logged",
      detail: `${seed.channel.toLowerCase()} report routed as ${seed.priority.toLowerCase()}`,
    },
    {
      id: `${seed.id}-a2`,
      timestamp: dispatchedAt,
      actor: "Coordination AI",
      action: "Recommendation generated",
      detail: seed.proposedAction.unit,
    },
    ...(seed.auditExtra ?? []).map((entry, index) => ({
      id: `${seed.id}-ax${index}`,
      timestamp: isoMinutesAgo(entry.minutesAgo),
      actor: entry.actor,
      action: entry.action,
      detail: entry.detail,
    })),
  ];

  return {
    id: seed.id,
    version: 1,
    category: seed.category,
    priority: seed.priority,
    status: seed.status ?? "NEEDS_REVIEW",
    summary: seed.summary,
    title: seed.title,
    location: {
      address: seed.address,
      district: seed.district,
      coordinates: [lng, lat],
    },
    channel: seed.channel,
    callerConnection: seed.callerConnection,
    peopleCount: seed.peopleCount ?? null,
    injuries: seed.injuries ?? "Not reported",
    hazards: seed.hazards ?? [],
    accessibilityNeeds: seed.accessibilityNeeds ?? [],
    destinationAgency: seed.destinationAgency,
    requestedResponse: seed.requestedResponse,
    missingFields: seed.missingFields ?? (seed.missingInfo ? [seed.missingInfo] : []),
    missingInfo: seed.missingInfo,
    claimedBy: null,
    viewers: [],
    receivedAt,
    updatedAt: dispatchedAt,
    transcript: [
      {
        id: `${seed.id}-t1`,
        speaker: "AI" as const,
        original: "Flare Net emergency line. You've reached flash-flood dispatch for Travis County. Tell me what's happening and where.",
        timestamp: isoMinutesAgo(seed.minutesAgo, 2),
        factIds: [],
      },
      {
        id: `${seed.id}-t2`,
        speaker: "CALLER" as const,
        original: seed.summary,
        timestamp: isoMinutesAgo(seed.minutesAgo, 6),
        factIds: ["summary", "hazards"],
      },
      {
        id: `${seed.id}-t3`,
        speaker: "AI" as const,
        original: `I have your location as ${seed.address} in ${seed.district}. Is that correct, and how many people are with you right now?`,
        timestamp: isoMinutesAgo(seed.minutesAgo, 12),
        factIds: ["address", "peopleCount"],
      },
      {
        id: `${seed.id}-t4`,
        speaker: "CALLER" as const,
        original:
          seed.peopleCount != null
            ? `Yes, that's right. There ${seed.peopleCount === 1 ? "is one person" : `are ${seed.peopleCount} of us`}. ${seed.injuries && seed.injuries !== "Not reported" ? seed.injuries + "." : "No injuries so far."}`
            : "Yes, that's the location. I'm not sure exactly how many people are involved yet.",
        timestamp: isoMinutesAgo(seed.minutesAgo, 20),
        factIds: ["peopleCount", "injuries"],
      },
      {
        id: `${seed.id}-t5`,
        speaker: "AI" as const,
        original:
          (seed.hazards?.length
            ? `Understood. Be aware of ${seed.hazards.join(" and ").toLowerCase()}. `
            : "") +
          "Stay on high ground away from moving water and keep this line open — a unit is being coordinated now.",
        timestamp: isoMinutesAgo(seed.minutesAgo, 28),
        factIds: ["hazards"],
      },
    ],
    evidence: [],
    activity,
    recommendation: {
      agency: seed.destinationAgency,
      units: seed.resources.map((resource) => resource.name),
      etaMinutes: Number.parseInt(seed.resources[0]?.eta.replace(/\D/g, "") || "6", 10) || 6,
      rationale: seed.rationale,
    },
    facts: seed.facts,
    assignedResources: seed.resources,
    proposedAction: seed.proposedAction,
    floodRadiusMeters: seed.floodRadiusMeters ?? 650,
    detailLabel: seed.detailLabel,
    failureReason: seed.failureReason,
  };
};

export const demoIncidents = incidentListSchema.parse([
  makeFloodIncident({
    id: "FN-2048",
    priority: "CRITICAL",
    category: "RESCUE",
    status: "NEEDS_REVIEW",
    minutesAgo: 8,
    dispatchedMinutesAgo: 6,
    title: "Vehicle swept off FM 969",
    address: "FM 969 near Blake Manor Rd",
    district: "Travis County / Walnut Creek",
    latLng: [30.328, -97.548],
    summary:
      "A passing motorist reported a dark four-door sedan washed off the FM 969 low-water crossing near Blake Manor Rd by fast-moving floodwaters. The driver climbed out and is now stranded on the vehicle roof as the current pushes the car against the downstream guardrail. The USGS gauge on Walnut Creek shows water 2.2 ft above flood stage and rising roughly 0.8 ft per hour, so the window for a safe shore-based rescue is closing. Traffic-cam imagery confirms the vehicle position and a single visible occupant.",
    channel: "PHONE",
    callerConnection: "CONNECTED",
    caller: "J. Martinez",
    peopleCount: 1,
    injuries: "No injuries reported; occupant stranded on vehicle roof, exposed to cold water and current",
    hazards: ["Fast-moving floodwater", "Submerged roadway", "Rising creek level", "Vehicle unstable against guardrail"],
    missingInfo:
      "Occupant headcount is unconfirmed: the initial 911 caller reports only one driver, but a second motorist reported a possible front-seat passenger. Swiftwater team has been notified to plan for two.",
    missingFields: ["Occupant headcount unconfirmed"],
    destinationAgency: "Travis County Swiftwater Rescue",
    requestedResponse: "Swiftwater rescue with heavy engine support",
    rationale:
      "Life-safety P1: an exposed occupant in active floodwater with a rising gauge trend is the highest-priority profile in the current event. Recommended dispatch is Swiftwater Rescue Unit 4 (closest boat-capable team, staged at Station 7) with Heavy Engine 12 from Station 22 for shore anchoring and lighting. Primary approach is FM 969 westbound, but that segment is inundated, so the optimizer routes both units via HWY 71 to the north bank — approximately 90 seconds longer but on passable roadway. Recommend staging EMS at the HWY 71 / FM 969 junction in case the occupant is hypothermic on extraction.",
    facts: [
      { text: "Dark colored sedan swept into Walnut Creek at the FM 969 crossing.", source: "911 CALL + TRAFFIC CAM" },
      { text: "One adult occupant observed on the roof of the vehicle.", source: "911 CALLER" },
      { text: "Water depth at gauge 14.2 ft (flood stage 12.0 ft, rising 0.8 ft/hr).", source: "USGS GAUGE #08158000" },
    ],
    resources: [
      { name: "Swiftwater Rescue 4", eta: "ETA 4m", onSite: false },
      { name: "Engine 12 (Station 22)", eta: "ETA 6m", onSite: false },
    ],
    proposedAction: {
      text: "Dispatch Swiftwater Rescue Team — Station 7 (En Route: ETA 4 min)",
      unit: "STATION 7 SWIFTWATER UNIT",
    },
    floodRadiusMeters: 900,
    detailLabel: "Walnut Creek Area Detail",
  }),
  makeFloodIncident({
    id: "FN-2049",
    priority: "URGENT",
    category: "RESCUE",
    minutesAgo: 5,
    title: "Family trapped on 2nd floor",
    address: "904 River Road, Austin",
    district: "Travis County / River Road",
    latLng: [30.311, -97.56],
    summary:
      "A resident at 904 River Road reports a family of four — two adults and two children — sheltering on the second floor as ground-level water rises inside the home. Water is now roughly 3 ft deep on the ground floor per the caller and a nearby street sensor, and household power has failed. No injuries are reported, but the caller is anxious and the children are young. The structure is single-access off River Road, which is partially inundated, so a wheeled approach may not reach the door.",
    channel: "PHONE",
    callerConnection: "CONNECTED",
    caller: "K. Nguyen",
    peopleCount: 4,
    injuries: "No injuries reported; two young children among the four occupants",
    hazards: ["Rising ground-floor water", "Power outage", "Single flooded access road"],
    accessibilityNeeds: ["Mobility status of occupants unconfirmed"],
    missingInfo:
      "Mobility status of the occupants is unconfirmed — dispatcher should verify whether anyone cannot self-evacuate before the boat team commits to an approach. Awaiting a callback from the resident.",
    missingFields: ["Occupant mobility status"],
    destinationAgency: "Austin Fire Department",
    requestedResponse: "Engine with boat support and ambulance staging",
    rationale:
      "P2 rescue with sheltered, uninjured occupants: no immediate water contact, so this ranks just below the exposed-in-water P1 calls. Recommended dispatch is Engine 3 carrying its inflatable boat plus Ambulance 1 for post-extraction assessment of the children. River Road is inundated at the low point, so the optimizer stages the units via Riverside Dr and approaches from the higher north side of the block. Recommend the boat crew confirm occupant mobility on arrival before choosing a window-versus-door extraction, given two small children.",
    facts: [
      { text: "Four occupants confirmed on the second floor.", source: "911 CALLER" },
      { text: "Ground floor flooded ~3 ft and rising.", source: "CALLER + SENSOR" },
    ],
    resources: [
      { name: "Engine 3", eta: "ETA 7m", onSite: false },
      { name: "Ambulance 1", eta: "ETA 9m", onSite: false },
    ],
    proposedAction: {
      text: "Dispatch Engine 3 + Ambulance 1 — River Road (Staging)",
      unit: "STATION 3 ENGINE",
    },
    floodRadiusMeters: 650,
    detailLabel: "River Road Area Detail",
  }),
  makeFloodIncident({
    id: "FN-2047",
    priority: "URGENT",
    category: "OTHER",
    minutesAgo: 17,
    title: "Road blocked by debris / flooding",
    address: "Gilbert Rd / FM 973",
    district: "Travis County / FM 973",
    latLng: [30.345, -97.531],
    summary:
      "A roadway flood sensor at the Gilbert Rd / FM 973 intersection tripped its high-water threshold and a public web report corroborates standing water and washed-in debris across all lanes. No persons or stranded vehicles are currently reported at the crossing, so this is an access-and-prevention task rather than a rescue. Left unmanaged, however, the crossing is a likely site for a future low-water-crossing entrapment as traffic diverts from other closed roads.",
    channel: "WEB",
    callerConnection: "ENDED",
    caller: "Automated sensor",
    peopleCount: 0,
    injuries: "Not reported",
    hazards: ["Standing water", "Roadway debris", "Potential future entrapment site"],
    missingInfo:
      "Extent of the debris field is unverified from sensor data alone; it cannot be confirmed until Road Unit R-22 arrives and inspects the crossing.",
    missingFields: ["Debris field extent"],
    destinationAgency: "Travis County Road & Bridge",
    requestedResponse: "Route closure and debris clearance",
    rationale:
      "P2 infrastructure task with no life safety in play, prioritized for prevention. Recommended dispatch is Road & Bridge maintenance unit R-22 to physically close and sign the FM 973 crossing and clear removable debris. Recommend posting a detour advisory to the public alerting layer so navigation apps steer traffic away, reducing the chance this becomes a swiftwater rescue. No EMS or fire resources are committed, keeping them available for the active P1 calls.",
    facts: [
      { text: "Standing water and debris across the intersection.", source: "SENSOR + PUBLIC" },
      { text: "No vehicles currently stranded.", source: "PATROL" },
    ],
    resources: [{ name: "Road Unit R-22", eta: "ETA 12m", onSite: false }],
    proposedAction: { text: "Dispatch Road Unit R-22 — FM 973 Closure", unit: "ROAD UNIT R-22" },
    floodRadiusMeters: 520,
    detailLabel: "FM 973 Crossing Detail",
  }),
  makeFloodIncident({
    id: "FN-2052",
    priority: "CRITICAL",
    category: "RESCUE",
    minutesAgo: 3,
    title: "Low-water crossing submerged, car stalled",
    address: "Onion Creek @ US-183",
    district: "Travis County / Onion Creek",
    latLng: [30.19, -97.7],
    summary:
      "A driver stalled attempting the Onion Creek low-water crossing at US-183 and is still inside the vehicle with floodwater entering the cabin at door-sill level. The occupant is conscious, on the phone with dispatch, and reports the car shifting slightly in the current. The USGS Onion Creek gauge shows high current velocity, making self-evacuation on foot dangerous. This is a life-safety P1 that will escalate quickly if the vehicle is swept off the crossing.",
    channel: "PHONE",
    callerConnection: "CONNECTED",
    caller: "D. Reyes",
    peopleCount: 1,
    injuries: "No injuries reported; water entering vehicle cabin, occupant advised to stay put",
    hazards: ["High current velocity", "Submerged low-water crossing", "Vehicle shifting in current"],
    missingInfo:
      "A possible second occupant is unconfirmed — the caller's audio was briefly unclear. Swiftwater 2 should stage for two until confirmed on scene.",
    missingFields: ["Second occupant unconfirmed"],
    destinationAgency: "Travis County Swiftwater Rescue",
    requestedResponse: "Swiftwater rescue, strong current advisory",
    rationale:
      "Life-safety P1: occupant in a vehicle taking on water in high current is time-critical. Recommended dispatch is Swiftwater Rescue 2, the nearest boat-capable unit to the Onion Creek corridor. Strong-current advisory issued: recommend the team approach and anchor from the north bank where the shoulder is above water and the eddy line offers a safer launch. Advise the caller to stay belted inside the vehicle unless it begins to submerge, as on-foot egress into this current has a high drowning risk.",
    facts: [
      { text: "Vehicle stalled mid-crossing, water at door level.", source: "911 CALLER" },
      { text: "Current velocity high per gauge.", source: "USGS GAUGE" },
    ],
    resources: [{ name: "Swiftwater Rescue 2", eta: "ETA 6m", onSite: false }],
    proposedAction: {
      text: "Dispatch Swiftwater Rescue 2 — Onion Creek (ETA 6 min)",
      unit: "STATION 2 SWIFTWATER UNIT",
    },
    floodRadiusMeters: 700,
    detailLabel: "Onion Creek Crossing Detail",
  }),
  makeFloodIncident({
    id: "FN-2051",
    priority: "URGENT",
    category: "RESCUE",
    minutesAgo: 11,
    title: "Stranded hikers on greenbelt",
    address: "Walnut Creek Metro Park",
    district: "Travis County / Walnut Creek Park",
    latLng: [30.398, -97.668],
    summary:
      "A park ranger reports two adult hikers stranded on the far bank of a normally-ankle-deep creek crossing on the Walnut Creek greenbelt, now running fast and waist-deep after upstream rainfall. Both are uninjured, on dry ground, and sheltering in place, so the risk is elevated but not immediate. The rising creek has cut off the direct trailhead, so a rescue will need an alternate approach on foot.",
    channel: "PHONE",
    callerConnection: "CONNECTED",
    caller: "Park ranger",
    peopleCount: 2,
    injuries: "No injuries reported; both hikers on dry ground and sheltering in place",
    hazards: ["Rising creek crossing", "Cut-off trailhead", "Fading daylight"],
    missingInfo:
      "The exact trail-marker location of the hikers is still being confirmed with the ranger so R-14 can pick the shortest passable approach.",
    missingFields: ["Trail marker location"],
    destinationAgency: "Travis County Trail Rescue",
    requestedResponse: "Trail rescue team to greenbelt crossing",
    rationale:
      "P2 rescue: subjects are stable and out of the water, so this sits below the in-water P1 calls but should not wait long given rising water and daylight. Recommended dispatch is Trail Rescue R-14, equipped for foot-access greenbelt terrain. Because the primary trailhead is cut off, recommend R-14 stage at the Metro Park north lot and approach via the upper ridge trail. Confirm the hikers' trail marker before the team commits so they don't have to backtrack across the flooded crossing.",
    facts: [
      { text: "Two hikers on the far bank of a flooded crossing.", source: "RANGER" },
      { text: "No injuries reported.", source: "RANGER" },
    ],
    resources: [{ name: "Trail Rescue R-14", eta: "ETA 15m", onSite: false }],
    proposedAction: { text: "Dispatch Trail Rescue R-14 — Greenbelt (ETA 15 min)", unit: "TRAIL RESCUE R-14" },
    floodRadiusMeters: 480,
    detailLabel: "Greenbelt Crossing Detail",
  }),
  makeFloodIncident({
    id: "FN-2040",
    priority: "ROUTINE",
    category: "WELFARE",
    status: "CLOSED",
    minutesAgo: 66,
    dispatchedMinutesAgo: 62,
    title: "Evacuation complete",
    address: "Del Valle High School Shelter",
    district: "Travis County / Del Valle",
    latLng: [30.352, -97.575],
    summary:
      "The precautionary evacuation of the low-lying River Road neighborhood to the Del Valle High School shelter is complete. All 32 registered residents are accounted for against the intake manifest, and the shelter is fully operational with cots, water, and a nurse on site. This incident is resolved and retained on the board for situational awareness; it is no longer consuming active response resources.",
    channel: "WEB",
    callerConnection: "ENDED",
    caller: "Shelter coordinator",
    peopleCount: 32,
    injuries: "None reported; one resident on oxygen relocated with equipment",
    hazards: [],
    missingInfo: "None outstanding.",
    missingFields: [],
    destinationAgency: "Travis County Emergency Management",
    requestedResponse: "Shelter operations and monitoring",
    rationale:
      "Resolved — monitoring only. All occupants are safe and accounted for and the shelter is at roughly 60% capacity with adequate supplies, so no further dispatch is required. Recommend keeping the incident visible for the remainder of the event in case rising water forces a second wave of arrivals, at which point it would be re-escalated. Bus B-10 and Shelter Team S-2 remain on site.",
    facts: [
      { text: "32 residents transported and accounted for.", source: "SHELTER LOG" },
      { text: "Shelter at 60% capacity, supplies adequate.", source: "COORDINATOR" },
    ],
    resources: [
      { name: "Bus B-10", eta: "ON SITE", onSite: true },
      { name: "Shelter Team S-2", eta: "ON SITE", onSite: true },
    ],
    proposedAction: { text: "Incident resolved — monitoring only", unit: "SHELTER TEAM S-2" },
    floodRadiusMeters: 400,
    detailLabel: "Del Valle Shelter Detail",
  }),
  makeFloodIncident({
    id: "FN-2045",
    priority: "ROUTINE",
    category: "OTHER",
    status: "CLOSED",
    minutesAgo: 120,
    dispatchedMinutesAgo: 115,
    title: "Power restored, area cleared",
    address: "Manor Rd substation",
    district: "Travis County / Manor",
    latLng: [30.29, -97.47],
    summary:
      "Floodwater around the Manor Rd substation has receded and Austin Energy restored power to the affected grid segment, bringing roughly 1,200 customers back online. The field crew has inspected and cleared the site with no equipment damage found. The incident is resolved; it remains on the board only so dispatchers can watch for a re-flood if upstream water returns.",
    channel: "WEB",
    callerConnection: "ENDED",
    caller: "Utility ops",
    peopleCount: 0,
    injuries: "None reported",
    hazards: [],
    missingInfo: "None outstanding.",
    missingFields: [],
    destinationAgency: "Austin Energy",
    requestedResponse: "Restore power and monitor for re-flood risk",
    rationale:
      "Resolved — monitoring only. Power is restored and the site is cleared, so no further action is required. Recommend Austin Energy keep Utility Unit U-5 on standby in the area for the duration of the event given the re-flood risk if Walnut Creek crests again; the incident would be re-escalated automatically if the substation sensor re-trips.",
    facts: [
      { text: "Power restored to 1,200 customers.", source: "UTILITY OPS" },
      { text: "Water fully receded at the substation.", source: "FIELD CREW" },
    ],
    resources: [{ name: "Utility Unit U-5", eta: "CLEARED", onSite: true }],
    proposedAction: { text: "Incident resolved — monitoring only", unit: "UTILITY UNIT U-5" },
    floodRadiusMeters: 350,
    detailLabel: "Manor Rd Substation Detail",
  }),
]);
