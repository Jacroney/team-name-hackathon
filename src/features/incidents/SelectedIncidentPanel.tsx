import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { ArrowSquareOutIcon, MapPinIcon, SparkleIcon } from "@phosphor-icons/react";
import {
  clockLabel,
  flarePriority,
  incidentResources,
  incidentTitle,
  priorityLabel,
} from "../../lib/flarenet";
import type { Incident } from "../../lib/schemas";

interface SelectedIncidentPanelProps {
  incident?: Incident;
  onOpenReport: (id: string) => void;
}

const badgeVariant = { p1: "error", p2: "warning", res: "success" } as const;

export function SelectedIncidentPanel({ incident, onOpenReport }: SelectedIncidentPanelProps) {
  if (!incident) {
    return (
      <div className="map-side-panel map-side-empty">
        <MapPinIcon size={26} aria-hidden="true" />
        <strong>No incident selected</strong>
        <span>Select a marker on the map to review its summary and open the full report.</span>
      </div>
    );
  }

  const priority = flarePriority(incident);
  const resources = incidentResources(incident);

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

      <div className="map-side-cta">
        <Button variant="primary" icon={ArrowSquareOutIcon} onClick={() => onOpenReport(incident.id)}>
          Open full report
        </Button>
      </div>
    </div>
  );
}
