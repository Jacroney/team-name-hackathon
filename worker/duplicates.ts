import { isDuplicateDetectionEnabled } from "./config";
import type { TriageQueueMessage } from "./contracts";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_TIME_DISTANCE_MS = 2 * 60 * 60 * 1_000;
const MAX_GEO_DISTANCE_METERS = 1_500;
const MIN_SIMILARITY_SCORE = 0.82;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function numericMetadata(
  metadata: Record<string, VectorizeVectorMetadata> | undefined,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function findPossibleDuplicates(
  env: Env,
  message: TriageQueueMessage,
): Promise<string[]> {
  const location = message.location;
  if (!location || !(await isDuplicateDetectionEnabled(env, message.jurisdictionId))) return [];

  try {
    const embeddingOutput = await env.AI.run(
      EMBEDDING_MODEL,
      { text: [message.triageInput.text], pooling: "cls" },
      {
        gateway: {
          id: env.AI_GATEWAY_ID,
          skipCache: true,
          collectLog: false,
          metadata: {
            incidentId: message.incidentId,
            jurisdictionId: message.jurisdictionId,
            purpose: "duplicate-detection",
          },
        },
        tags: ["crisis-mesh", "duplicate-detection"],
      },
    );
    if (!("data" in embeddingOutput) || !embeddingOutput.data?.[0]) return [];
    const vector = embeddingOutput.data[0];
    const receivedAtMs = Date.parse(message.receivedAt);
    const matches = await env.DUPLICATE_REPORTS.query(vector, {
      topK: 10,
      returnMetadata: "all",
      filter: {
        jurisdictionId: { $eq: message.jurisdictionId },
        receivedAtMs: { $gte: receivedAtMs - MAX_TIME_DISTANCE_MS },
      },
    });

    const possibleDuplicateIds = matches.matches
      .filter((match) => {
        if (match.id === message.incidentId || match.score < MIN_SIMILARITY_SCORE) return false;
        const latitude = numericMetadata(match.metadata, "latitude");
        const longitude = numericMetadata(match.metadata, "longitude");
        const candidateReceivedAt = numericMetadata(match.metadata, "receivedAtMs");
        if (latitude === null || longitude === null || candidateReceivedAt === null) return false;
        const closeInTime = Math.abs(receivedAtMs - candidateReceivedAt) <= MAX_TIME_DISTANCE_MS;
        const closeInSpace =
          distanceMeters(
            location.latitude,
            location.longitude,
            latitude,
            longitude,
          ) <= MAX_GEO_DISTANCE_METERS;
        return closeInTime && closeInSpace;
      })
      .slice(0, 5)
      .map((match) => match.id);

    await env.DUPLICATE_REPORTS.upsert([
      {
        id: message.incidentId,
        values: vector,
        metadata: {
          jurisdictionId: message.jurisdictionId,
          receivedAtMs,
          latitude: location.latitude,
          longitude: location.longitude,
        },
      },
    ]);
    return possibleDuplicateIds;
  } catch {
    return [];
  }
}
