import { WarningOctagon, Check, Circle, Broadcast, ArrowsClockwise, Users } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { PriorityBadge } from "../../components/PriorityBadge";
import { formatIncidentStatus } from "../../lib/incidentUtils";
import type { Incident } from "../../lib/schemas";
import { ActivityTimeline } from "./ActivityTimeline";
import { EvidenceGallery } from "./EvidenceGallery";
import { LocationMap } from "./LocationMap";
import { Transcript } from "./Transcript";

interface IncidentWorkspaceProps {
  incident: Incident;
}

interface FactButtonProps {
  id: string;
  label: string;
  value: string;
  active: boolean;
  onSelect: (id: string) => void;
}

const FactButton = ({ id, label, value, active, onSelect }: FactButtonProps) => (
  <button
    type="button"
    className="fact-button"
    data-active={active || undefined}
    aria-pressed={active}
    onClick={() => onSelect(id)}
    title="Show source in transcript"
  >
    <span>{label}</span>
    <strong>{value}</strong>
    <small><Circle size={11} /> View source</small>
  </button>
);

export function IncidentWorkspace({ incident }: IncidentWorkspaceProps) {
  const [highlightedFact, setHighlightedFact] = useState<string>();

  useEffect(() => setHighlightedFact(undefined), [incident.id]);

  return (
    <div className="incident-workspace">
      <header className="workspace-header">
        <div className="workspace-title">
          <span className="eyebrow">INCIDENT DETAILS</span>
          <div><h1>{incident.id}</h1><PriorityBadge priority={incident.priority} /></div>
        </div>
        <div className="workspace-statuses">
          <span className="status-chip" data-status={incident.status.toLowerCase()}>
            {formatIncidentStatus(incident.status)}
          </span>
          <span className="caller-chip" data-state={incident.callerConnection.toLowerCase()}>
            <Broadcast size={12} /> Caller {incident.callerConnection.toLowerCase()}
          </span>
        </div>
      </header>

      {incident.status === "FAILED" && (
        <div className="failure-banner" role="alert">
          <WarningOctagon size={19} />
          <div><strong>Dispatch failed</strong><span>{incident.failureReason ?? "The destination agency did not acknowledge this dispatch."}</span></div>
        </div>
      )}

      <div className="workspace-scroll">
        <section className="workspace-section situation-section">
          <div className="section-heading">
            <div><span className="eyebrow">AI SYNTHESIS</span><h2>Situation summary</h2></div>
            <span className="confidence"><Check size={12} /> 94% extraction confidence</span>
          </div>
          <p className="situation-summary">{incident.summary}</p>
          <div className="fact-grid">
            <FactButton id="peopleCount" label="People" value={incident.peopleCount?.toString() ?? "Unknown"} active={highlightedFact === "peopleCount"} onSelect={setHighlightedFact} />
            <FactButton id="injuries" label="Reported injuries" value={incident.injuries} active={highlightedFact === "injuries"} onSelect={setHighlightedFact} />
            <FactButton id="hazards" label="Hazards" value={incident.hazards.join(", ") || "None reported"} active={highlightedFact === "hazards"} onSelect={setHighlightedFact} />
            <FactButton id="accessibilityNeeds" label="Accessibility" value={incident.accessibilityNeeds.join(", ") || "None reported"} active={highlightedFact === "accessibilityNeeds"} onSelect={setHighlightedFact} />
          </div>
          <div className="presence-strip">
            <Users size={14} />
            <strong>{incident.viewers.length > 0 ? incident.viewers.join(", ") : "No other operators"}</strong>
            <span>{incident.viewers.length === 1 ? "is" : "are"} viewing this incident</span>
          </div>
        </section>

        <section className="workspace-section map-section">
          <div className="section-heading compact"><div><span className="eyebrow">VERIFIED LOCATION</span><h2>Location</h2></div></div>
          <button className="address-source" type="button" onClick={() => setHighlightedFact("address")} aria-pressed={highlightedFact === "address"}>
            <Circle size={12} /> Show address source
          </button>
          <LocationMap
            address={incident.location.address}
            district={incident.location.district}
            coordinates={incident.location.coordinates}
          />
        </section>

        <Transcript messages={incident.transcript} highlightedFact={highlightedFact} />

        <div className="workspace-bottom-grid">
          <EvidenceGallery evidence={incident.evidence} />
          <ActivityTimeline activity={incident.activity} />
        </div>
      </div>
    </div>
  );
}

export function WorkspaceLoading() {
  return (
    <div className="workspace-loading" aria-label="Loading incident">
      <div className="workspace-loading-bar" />
      <div className="workspace-loading-block" />
      <div className="workspace-loading-block short" />
    </div>
  );
}

export function WorkspaceEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="workspace-empty">
      <WarningOctagon size={26} />
      <strong>{onRetry ? "Incident unavailable" : "Select an incident"}</strong>
      <span>{onRetry ? "The incident detail could not be loaded." : "Use ↑ and ↓ to move through the queue, then press Enter."}</span>
      {onRetry && <button type="button" className="button secondary" onClick={onRetry}><ArrowsClockwise size={14} /> Retry</button>}
    </div>
  );
}
