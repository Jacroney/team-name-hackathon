import { z } from "zod";
import { HttpError } from "./errors";
import { readJsonBody } from "./http";
import { authorizeOperator } from "./auth";

const requestSchema = z.object({ query: z.string().trim().min(3).max(2_000) }).strict();

export async function handleGuidance(request: Request, env: Env): Promise<Response> {
  await authorizeOperator(request, env);
  requestSchema.parse(await readJsonBody(request));
  throw new HttpError(503, "guidance_unavailable", "SOP guidance is temporarily unavailable");
}
