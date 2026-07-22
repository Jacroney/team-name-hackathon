import {
  recommendedReviewPrioritySchema,
  type GeospatialAssessment,
  type RecommendedReviewPriority,
  type TriageResult,
} from "./contracts";
import type { PriorityPolicy } from "./config";

export function calculateRecommendedReviewPriority(
  triage: TriageResult,
  geospatial: GeospatialAssessment | null,
  policy: PriorityPolicy,
): RecommendedReviewPriority {
  let score = policy.severityScores[triage.severity];
  const reasons: string[] = [`Extracted severity: ${triage.severity}`];

  if (triage.immediateThreat) {
    score += policy.immediateThreatScore;
    reasons.push("Immediate threat reported");
  }
  if (triage.injuriesReported) {
    score += policy.injuriesScore;
    reasons.push("Injuries reported");
  }
  if ((triage.peopleCount ?? 0) >= 2) {
    score += policy.multiplePeopleScore;
    reasons.push("Multiple people may be affected");
  }
  if (triage.accessibilityNeeds.length > 0) {
    score += policy.accessibilityScore;
    reasons.push("Accessibility support reported");
  }
  if (geospatial?.insideHazardZone) {
    score += policy.hazardZoneScore;
    reasons.push("Location intersects a known hazard zone");
  }
  if (geospatial?.evacuationZone) {
    score += policy.evacuationZoneScore;
    reasons.push("Location intersects an evacuation zone");
  }
  if ((geospatial?.blockedRoadsNearby ?? 0) > 0) {
    score += policy.blockedRoadScore;
    reasons.push("Blocked roads may affect response access");
  }

  const boundedScore = Math.min(100, score);
  const level =
    boundedScore >= policy.criticalThreshold
      ? "CRITICAL"
      : boundedScore >= policy.urgentThreshold
        ? "URGENT"
        : boundedScore > 0
          ? "ROUTINE"
          : "UNKNOWN";

  return recommendedReviewPrioritySchema.parse({
    level,
    score: boundedScore,
    reasons,
    policyVersion: policy.version,
    supportingEvidence: triage.evidence,
  });
}
