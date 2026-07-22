import { z } from "zod";
import { HttpError } from "./errors";
import { jsonResponse, readJsonBody } from "./http";
import { authorizeOperator } from "./auth";

const requestSchema = z.object({ query: z.string().trim().min(3).max(2_000) }).strict();

export async function handleGuidance(request: Request, env: Env): Promise<Response> {
  await authorizeOperator(request, env);
  const { query } = requestSchema.parse(await readJsonBody(request));
  try {
    const result = await env.SOP_SEARCH.search({ query });
    return jsonResponse({
      query: result.search_query,
      guidance: result.chunks.slice(0, 5).map((chunk) => ({
        id: chunk.id,
        score: chunk.score,
        text: chunk.text,
        source: chunk.item,
      })),
    });
  } catch {
    throw new HttpError(503, "guidance_unavailable", "SOP guidance is temporarily unavailable");
  }
}
