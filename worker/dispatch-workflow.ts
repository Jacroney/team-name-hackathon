import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { incidentRecordSchema } from "./contracts";
import { recordIncidentChange } from "./projection";

export interface DispatchWorkflowParams {
  incidentId: string;
  jurisdictionId: string;
  operator: string;
  destinationAgency: string;
  requestedResponse: string;
}

export class DispatchWorkflow extends WorkflowEntrypoint<Env, DispatchWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<DispatchWorkflowParams>>, step: WorkflowStep): Promise<void> {
    const { incidentId, jurisdictionId, operator, destinationAgency, requestedResponse } = event.payload;
    await step.do("deliver dispatch", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, async () => {
      if (!this.env.DISPATCH_WEBHOOK_URL) return { delivery: "recorded" };
      const response = await fetch(this.env.DISPATCH_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, jurisdictionId, destinationAgency, requestedResponse }),
      });
      if (!response.ok) throw new Error("Dispatch endpoint rejected delivery");
      return { delivery: "accepted" };
    });

    await step.do("notify supervisor", async () => {
      if (!this.env.EMAIL_FROM || !this.env.SUPERVISOR_EMAIL) return;
      await this.env.EMAIL.send({
        from: { email: this.env.EMAIL_FROM, name: "Crisis Mesh" },
        to: this.env.SUPERVISOR_EMAIL,
        subject: `Dispatch started: ${incidentId}`,
        text: `${requestedResponse} was submitted to ${destinationAgency}.`,
        html: `<p><strong>${requestedResponse}</strong> was submitted to ${destinationAgency}.</p>`,
      });
    });

    const result = await step.do("record dispatch completion", async () =>
      this.env.INCIDENT_STORE.getByName(jurisdictionId).completeDispatch(jurisdictionId, incidentId, operator),
    );
    if (!result.ok) throw new Error(result.message);
    const incident = incidentRecordSchema.parse(JSON.parse(result.incidentJson));
    await this.env.JURISDICTION_HUB.getByName(jurisdictionId).publishIncidentUpdate(
      jurisdictionId,
      incident.version - 1,
      result.incidentJson,
      result.patchJson,
    );
    await recordIncidentChange(this.env, incident, "dispatch.completed");
  }
}
