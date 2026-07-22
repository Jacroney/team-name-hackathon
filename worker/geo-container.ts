import { Container, getRandom } from "@cloudflare/containers";
import { geospatialAssessmentSchema, type GeoQueueMessage, type GeospatialAssessment } from "./contracts";

export class HazardAnalysisContainer extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "localhost/health";
  sleepAfter = "10m";
  enableInternet = false;
  allowedHosts = [`${this.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`];
  envVars = {
    AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
    HAZARD_BUCKET_PREFIX: this.env.HAZARD_BUCKET_PREFIX,
  };
}

function containerInstanceCount(env: Env): number {
  const parsed = Number(env.GEO_CONTAINER_INSTANCES);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 20 ? parsed : 3;
}

export async function runGeospatialAssessment(
  env: Env,
  message: GeoQueueMessage,
): Promise<GeospatialAssessment> {
  if (!message.location) throw new Error("Geospatial location is unavailable");
  const location = message.location;
  const container = await getRandom(env.HAZARD_ANALYSIS, containerInstanceCount(env));
  await container.startAndWaitForPorts({
    ports: 8080,
    cancellationOptions: { portReadyTimeoutMS: 30_000 },
  });
  const response = await container.fetch(
    new Request("http://container/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jurisdictionId: message.jurisdictionId,
        latitude: location.latitude,
        longitude: location.longitude,
        blockedRoadRadiusMeters: 1_000,
      }),
    }),
  );
  if (!response.ok) throw new Error("Geospatial Container request failed");
  return geospatialAssessmentSchema.parse(await response.json());
}
