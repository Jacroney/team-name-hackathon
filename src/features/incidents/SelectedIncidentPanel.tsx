import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  HandTapIcon,
  MapPinIcon,
  SealCheckIcon,
  SparkleIcon,
  UserPlusIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import {
  clockLabel,
  flarePriority,
  incidentResources,
  incidentTitle,
  priorityLabel,
  statusLabel,
} from "../../lib/flarenet";
import {
  VersionConflictError,
  claimIncident,
  performIncidentAction,
} from "../../lib/api";
import { sortIncidents } from "../../lib/incidentUtils";
import type { Incident } from "../../lib/schemas";

interface SelectedIncidentPanelProps {
  incident?: Incident;
  onOpenReport: (id: string) => void;
}

const badgeVariant = { p1: "error", p2: "warning", res: "success" } as const;

type LifecycleAction = "ASSIGN" | "ACKNOWLEDGE" | "RESOLVE";

const RESOLVED_STATES = new Set<Incident["status"]>(["RESOLVED", "CLOSED"]);

export function SelectedIncidentPanel({ incident, onOpenReport }: SelectedIncidentPanelProps) {
  const queryClient = useQueryClient();

  const commit = (next: Incident): void => {
    queryClient.setQueryData(["incident", next.id], next);
    queryClient.setQueryData<Incident[]>(["incidents"], (current) => {
      if (!current) return [next];
      const exists = current.some((item) => item.id === next.id);
      return sortIncidents(
        exists ? current.map((item) => (item.id === next.id ? next : item)) : [next, ...current],
      );
    });
  };

  const mutation = useMutation({
    mutationFn: async ({
      action,
      target,
    }: {
      action: LifecycleAction;
      target: Incident;
    }): Promise<Incident> => {
      if (action === "ASSIGN") return claimIncident(target.id, target.version);
      return performIncidentAction(target.id, target.version, action);
    },
    onSuccess: (next) => commit(next),
  });

  if (!incident) {
    return (
      <div className="map-side-panel map-side-empty">
        <MapPinIcon size={26} aria-hidden="true" />
        <strong>No incident selected</strong>
        <span>Select a marker on the map to review its summary and act on it.</span>
      </div>
    );
  }

  const priority = flarePriority(incident);
  const resources = incidentResources(incident);
  const assigned = Boolean(incident.claimedBy);
  const resolved = RESOLVED_STATES.has(incident.status);
  const acknowledged = incident.status === "ACKNOWLEDGED" || resolved;
  const pending = mutation.isPending;

  const run = (action: LifecycleAction): void => mutation.mutate({ action, target: incident });

  const errorMessage =
    mutation.error instanceof VersionConflictError
      ? "Incident changed — reselect to get the latest version."
      : mutation.error instanceof Error
        ? mutation.error.message
        : undefined;

  return (
    <div className="map-side-panel">
      <div className="map-side-head">
        <span className="map-side-eyebrow">Incident summary</span>
        <Badge variant={badgeVariant[priority]} appearance="dot">
          {priority === "res" ? "Resolved" : `Critical ${priorityLabel[priority]}`}
        </Badge>
      </div>

      <div className="map-side-body">
        <h2 className="map-side-title">{incidentTitle(incident)}</h2>
        <p className="map-side-loc"><MapPinIcon size={14} aria-hidden="true" /> {incident.location.address}</p>

        <div className="map-side-kv">
          <div><span>Incident</span><strong>{incident.id}</strong></div>
          <div><span>Received</span><strong>{clockLabel(incident.receivedAt)}</strong></div>
          <div><span>Channel</span><strong>{incident.channel}</strong></div>
        </div>

        <div className="map-side-ai">
          <h3><SparkleIcon size={14} aria-hidden="true" /> AI coordination rec</h3>
          <p>{incident.recommendation.rationale}</p>
        </div>

        <div className="map-side-resources">
          <span className="map-side-sec">Assigned resources</span>
          {resources.map((resource) => (
            <div className="map-side-resource" key={resource.name}>
              <span>{resource.name}</span>
              <Badge variant={resource.onSite ? "success" : "neutral"}>{resource.eta}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="map-side-lifecycle" aria-label="Incident response actions">
        <div className="lifecycle-status">
          <span>Status</span>
          <strong data-resolved={resolved || undefined}>
            {statusLabel[incident.status]}
            {incident.claimedBy ? ` · ${incident.claimedBy}` : ""}
          </strong>
        </div>

        <div className="lifecycle-steps" role="group">
          <button
            type="button"
            className="lifecycle-btn"
            data-done={assigned || undefined}
            disabled={pending || assigned || resolved}
            onClick={() => run("ASSIGN")}
          >
            {assigned ? <SealCheckIcon size={15} weight="fill" /> : <UserPlusIcon size={15} />}
            <span>{assigned ? "Assigned" : "Assign"}</span>
          </button>
          <button
            type="button"
            className="lifecycle-btn"
            data-done={acknowledged || undefined}
            disabled={pending || !assigned || acknowledged}
            onClick={() => run("ACKNOWLEDGE")}
          >
            {acknowledged ? <SealCheckIcon size={15} weight="fill" /> : <HandTapIcon size={15} />}
            <span>{acknowledged ? "Acknowledged" : "Acknowledge"}</span>
          </button>
          <button
            type="button"
            className="lifecycle-btn lifecycle-resolve"
            data-done={resolved || undefined}
            disabled={pending || !assigned || resolved}
            onClick={() => run("RESOLVE")}
          >
            {resolved ? <CheckCircleIcon size={15} weight="fill" /> : <CheckCircleIcon size={15} />}
            <span>{resolved ? "Resolved" : "Resolve"}</span>
          </button>
        </div>

        {pending && (
          <p className="lifecycle-note" role="status">
            <CircleNotchIcon size={13} className="spin" /> Awaiting server acknowledgement…
          </p>
        )}
        {!pending && errorMessage && (
          <p className="lifecycle-note lifecycle-error" role="alert">
            <WarningIcon size={13} /> {errorMessage}
          </p>
        )}
      </div>

      <div className="map-side-cta">
        <Button variant="primary" icon={ArrowSquareOutIcon} onClick={() => onOpenReport(incident.id)}>
          Open full report
        </Button>
      </div>
    </div>
  );
}
