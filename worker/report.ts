import { authorizeOperator } from "./auth";
import { getIncident } from "./incidents";
import { incidentSchema } from "../src/lib/schemas";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export async function handleIncidentReport(request: Request, env: Env, incidentId: string): Promise<Response> {
  await authorizeOperator(request, env);
  const incident = incidentSchema.parse(await getIncident(env, env.JURISDICTION_ID, incidentId));
  const response = await env.BROWSER.quickAction("pdf", {
    html: `<main><h1>Dispatch packet: ${escapeHtml(incident.id)}</h1><p><strong>Status:</strong> ${escapeHtml(String(incident.status))}</p><p><strong>Priority:</strong> ${escapeHtml(String(incident.priority))}</p><p><strong>Location:</strong> ${escapeHtml(String(incident.location?.address ?? "Unknown"))}</p><p>${escapeHtml(String(incident.summary ?? ""))}</p></main>`,
    pdfOptions: { format: "letter", printBackground: true },
  });
  const headers = new Headers(response.headers);
  headers.set("Content-Disposition", `attachment; filename="${incidentId}-dispatch.pdf"`);
  return new Response(response.body, { status: response.status, headers });
}
