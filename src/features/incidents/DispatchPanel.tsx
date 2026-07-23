import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Warning,
  ArrowRight,
  SealCheck,
  Buildings,
  CheckCircle,
  Question,
  ClipboardText,
  Clock,
  Copy,
  CircleNotch,
  LockKey,
  CellTower,
  ArrowsClockwise,
  ShieldWarning,
  UserCheck,
  Users,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  VersionConflictError,
  claimIncident,
  dispatchIncident,
  performIncidentAction,
  type IncidentAction,
} from "../../lib/api";
import { sortIncidents } from "../../lib/incidentUtils";
import {
  dispatchDraftSchema,
  incidentCategorySchema,
  prioritySchema,
  type DispatchDraft,
  type Incident,
} from "../../lib/schemas";

const OPERATOR = "A. Okafor";

const draftFromIncident = (incident: Incident): DispatchDraft => ({
  category: incident.category,
  priority: incident.priority,
  address: incident.location.address,
  peopleCount: incident.peopleCount,
  injuries: incident.injuries,
  hazards: incident.hazards,
  accessibilityNeeds: incident.accessibilityNeeds,
  destinationAgency: incident.destinationAgency,
  requestedResponse: incident.requestedResponse,
});

type PanelAction =
  | { kind: "CLAIM" }
  | { kind: "DISPATCH"; draft: DispatchDraft }
  | { kind: IncidentAction };

const successLabels: Record<PanelAction["kind"], string> = {
  CLAIM: "Incident claimed. You now hold the approval lock.",
  DISPATCH: "Dispatch workflow started. Delivery acknowledgement is being tracked.",
  REQUEST_CLARIFICATION: "Clarification request sent to the caller session.",
  ESCALATE: "Incident escalated to the duty supervisor.",
  MARK_DUPLICATE: "Incident closed as a duplicate.",
  RETRY_DISPATCH: "Dispatch retry acknowledged by the destination agency.",
  ACKNOWLEDGE: "Acknowledged — responder marked en route.",
  RESOLVE: "Incident resolved on scene.",
};

export function DispatchPanel({ incident }: { incident: Incident }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DispatchDraft>(() => draftFromIncident(incident));
  const [baseVersion, setBaseVersion] = useState(incident.version);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const resetDraft = (next: Incident): void => {
    setDraft(draftFromIncident(next));
    setBaseVersion(next.version);
    setDirty(false);
  };

  useEffect(() => {
    resetDraft(incident);
    setNotice(undefined);
    setError(undefined);
  }, [incident.id]);

  useEffect(() => {
    if (incident.version !== baseVersion && !dirty) resetDraft(incident);
  }, [baseVersion, dirty, incident]);

  const commitServerIncident = (next: Incident): void => {
    resetDraft(next);
    queryClient.setQueryData(["incident", next.id], next);
    queryClient.setQueryData<Incident[]>(["incidents"], (current) => {
      if (!current) return [next];
      const exists = current.some((item) => item.id === next.id);
      return sortIncidents(exists
        ? current.map((item) => (item.id === next.id ? next : item))
        : [next, ...current]);
    });
  };

  const mutation = useMutation({
    mutationFn: async (action: PanelAction): Promise<Incident> => {
      if (action.kind === "CLAIM") return claimIncident(incident.id, baseVersion);
      if (action.kind === "DISPATCH") {
        return dispatchIncident({ id: incident.id, expectedVersion: baseVersion, draft: action.draft });
      }
      return performIncidentAction(incident.id, baseVersion, action.kind);
    },
    onMutate: () => {
      setNotice(undefined);
      setError(undefined);
    },
    onSuccess: (next, action) => {
      commitServerIncident(next);
      setNotice(successLabels[action.kind]);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof VersionConflictError
        ? mutationError.message
        : mutationError instanceof Error
          ? mutationError.message
          : "The server did not acknowledge the action.");
    },
  });

  function updateField<K extends keyof DispatchDraft>(field: K, value: DispatchDraft[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setNotice(undefined);
  }

  const conflict = incident.version !== baseVersion;
  const claimedByOther = Boolean(incident.claimedBy && incident.claimedBy !== OPERATOR);
  const claimedByOperator = incident.claimedBy === OPERATOR;
  const closed = incident.status === "DISPATCHED" || incident.status === "CLOSED";
  const valid = dispatchDraftSchema.safeParse(draft).success;
  const dispatchDisabled = mutation.isPending || conflict || claimedByOther || !claimedByOperator || !valid || closed;
  const listValue = (values: string[]): string => values.join(", ");
  const parseList = (value: string): string[] => value.split(",").map((item) => item.trim()).filter(Boolean);

  return (
    <div className="dispatch-panel">
      <header className="dispatch-header">
        <div><span className="eyebrow">REVIEW &amp; AUTHORIZE</span><h1>Dispatch decision</h1></div>
        <span className="version-label">VER {incident.version}</span>
      </header>

      {mutation.isPending && (
        <div className="acknowledgement-pending" role="status">
          <CircleNotch size={16} className="spin" />
          <div><strong>Awaiting server acknowledgement</strong><span>No status change has been applied yet.</span></div>
        </div>
      )}
      {notice && <div className="action-notice" role="status"><CheckCircle size={16} /><span>{notice}</span></div>}
      {error && <div className="action-error" role="alert"><Warning size={16} /><span>{error}</span></div>}
      {conflict && (
        <div className="conflict-banner" role="alert">
          <LockKey size={17} />
          <div><strong>Newer incident version available</strong><span>Your edits are based on version {baseVersion}. Dispatch is locked.</span></div>
          <button type="button" onClick={() => resetDraft(incident)}>Review v{incident.version}</button>
        </div>
      )}
      {claimedByOther && (
        <div className="claim-warning">
          <Users size={16} /><span><strong>{incident.claimedBy}</strong> holds the approval lock.</span>
        </div>
      )}

      {incident.status === "FAILED" && (
        <section className="dispatch-failure" aria-label="Dispatch failure">
          <div><ShieldWarning size={18} /><strong>Dispatch failed</strong></div>
          <p>{incident.failureReason ?? "The agency endpoint returned an error."}</p>
          <div className="failure-actions">
            <ConfirmDialog
              trigger={<button className="button danger" type="button" disabled={mutation.isPending}><ArrowsClockwise size={14} /> Retry dispatch</button>}
              title="Retry this dispatch?"
              description={`Resend version ${baseVersion} to ${incident.destinationAgency}. The console will wait for a new acknowledgement.`}
              confirmLabel="Retry dispatch"
              onConfirm={() => mutation.mutate({ kind: "RETRY_DISPATCH" })}
              intent="danger"
            />
            <button className="button secondary" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: "ESCALATE" })}>
              Escalate
            </button>
          </div>
        </section>
      )}

      <section className="claim-section">
        <div className="claim-state">
          <span className="claim-icon" data-claimed={Boolean(incident.claimedBy) || undefined}><UserCheck size={17} /></span>
          <div>
            <span>Approval owner</span>
            <strong>{incident.claimedBy ?? "Unclaimed"}</strong>
          </div>
        </div>
        {!incident.claimedBy && (
          <button className="button claim-button" type="button" disabled={mutation.isPending || conflict} onClick={() => mutation.mutate({ kind: "CLAIM" })}>
            Claim incident
          </button>
        )}
        {claimedByOperator && <span className="you-hold-lock"><SealCheck size={14} /> You hold the lock</span>}
      </section>

      <div className="dispatch-scroll">
        <section className="panel-section">
          <div className="panel-section-heading">
            <div><span className="section-number">01</span><h2>Extracted fields</h2></div>
            {dirty && <span className="unsaved-label"><ClipboardText size={12} /> EDITED</span>}
          </div>
          <div className="dispatch-form">
            <label>
              <span>Incident category</span>
              <select value={draft.category} onChange={(event) => updateField("category", incidentCategorySchema.parse(event.target.value))}>
                {incidentCategorySchema.options.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={draft.priority} onChange={(event) => updateField("priority", prioritySchema.parse(event.target.value))}>
                {prioritySchema.options.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-span">
              <span>Address</span>
              <input value={draft.address} onChange={(event) => updateField("address", event.target.value)} />
            </label>
            <label>
              <span>Number of people</span>
              <input
                type="number"
                min="0"
                value={draft.peopleCount ?? ""}
                onChange={(event) => updateField("peopleCount", event.target.value === "" ? null : Number(event.target.value))}
              />
            </label>
            <label>
              <span>Injuries</span>
              <input value={draft.injuries} onChange={(event) => updateField("injuries", event.target.value)} />
            </label>
            <label className="form-span">
              <span>Hazards <small>comma separated</small></span>
              <textarea rows={2} value={listValue(draft.hazards)} onChange={(event) => updateField("hazards", parseList(event.target.value))} />
            </label>
            <label className="form-span">
              <span>Accessibility needs</span>
              <input value={listValue(draft.accessibilityNeeds)} onChange={(event) => updateField("accessibilityNeeds", parseList(event.target.value))} />
            </label>
            <label className="form-span">
              <span>Destination agency</span>
              <input value={draft.destinationAgency} onChange={(event) => updateField("destinationAgency", event.target.value)} />
            </label>
            <label className="form-span">
              <span>Requested response</span>
              <textarea rows={2} value={draft.requestedResponse} onChange={(event) => updateField("requestedResponse", event.target.value)} />
            </label>
          </div>
        </section>

        <section className="panel-section recommendation-section">
          <div className="panel-section-heading"><div><span className="section-number">02</span><h2>Recommended route</h2></div></div>
          <div className="route-agency"><Buildings size={16} /><div><span>DESTINATION</span><strong>{draft.destinationAgency || "Not selected"}</strong></div></div>
          <div className="route-path">
            <span>Crisis Mesh</span><ArrowRight size={14} /><span>{incident.recommendation.agency}</span>
          </div>
          <div className="unit-list">
            {incident.recommendation.units.map((unit) => <span key={unit}><CellTower size={12} /> {unit}</span>)}
          </div>
          <div className="route-eta"><Clock size={14} /><strong>{incident.recommendation.etaMinutes} min</strong><span>estimated first-unit arrival</span></div>
          <p>{incident.recommendation.rationale}</p>
        </section>

        <section className="panel-section missing-section">
          <div className="panel-section-heading"><div><span className="section-number">03</span><h2>Missing fields</h2></div><span className="section-count">{incident.missingFields.length}</span></div>
          {incident.missingFields.length > 0 ? (
            <ul>{incident.missingFields.map((field) => <li key={field}><Question size={13} /> {field}</li>)}</ul>
          ) : <div className="all-complete"><CheckCircle size={14} /> All critical fields complete</div>}
        </section>
      </div>

      <footer className="dispatch-actions">
        {!valid && <div className="validation-warning"><Warning size={13} /> Address, agency, and requested response are required.</div>}
        {!claimedByOperator && !claimedByOther && <div className="lock-hint"><LockKey size={12} /> Claim this incident to enable dispatch.</div>}
        <div className="dispatch-primary-actions">
          <ConfirmDialog
            trigger={<button className="button approve-button" type="button" disabled={dispatchDisabled || dirty}><SealCheck size={16} /> Approve and dispatch</button>}
            title="Confirm emergency dispatch"
            description={`Send ${draft.requestedResponse} to ${draft.destinationAgency}. This action uses incident version ${baseVersion}.`}
            confirmLabel="Approve and dispatch"
            onConfirm={() => mutation.mutate({ kind: "DISPATCH", draft })}
          />
          <ConfirmDialog
            trigger={<button className="button edit-dispatch-button" type="button" disabled={dispatchDisabled || !dirty}><ClipboardText size={15} /> Edit and dispatch</button>}
            title="Confirm edited dispatch"
            description={`Dispatch your edited incident fields to ${draft.destinationAgency}. This action uses incident version ${baseVersion}.`}
            confirmLabel="Dispatch edited incident"
            onConfirm={() => mutation.mutate({ kind: "DISPATCH", draft })}
          />
        </div>
        <div className="dispatch-secondary-actions">
          <button type="button" disabled={mutation.isPending || closed} onClick={() => mutation.mutate({ kind: "REQUEST_CLARIFICATION" })}><Question size={14} /> Request clarification</button>
          <button type="button" disabled={mutation.isPending || closed} onClick={() => mutation.mutate({ kind: "ESCALATE" })}><ShieldWarning size={14} /> Escalate</button>
          <ConfirmDialog
            trigger={<button type="button" disabled={mutation.isPending || closed}><Copy size={14} /> Mark duplicate</button>}
            title="Mark as duplicate?"
            description="Close this incident without dispatching it. The action will be recorded in the audit trail."
            confirmLabel="Mark duplicate"
            onConfirm={() => mutation.mutate({ kind: "MARK_DUPLICATE" })}
            intent="danger"
          />
        </div>
      </footer>
    </div>
  );
}
