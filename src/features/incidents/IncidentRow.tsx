import { GlobeHemisphereWest, ChatText, Phone, Broadcast, Warning, User } from "@phosphor-icons/react";
import type { Ref } from "react";
import { PriorityBadge } from "../../components/PriorityBadge";
import { formatElapsed, formatIncidentStatus } from "../../lib/incidentUtils";
import type { Incident } from "../../lib/schemas";

interface IncidentRowProps {
  incident: Incident;
  selected: boolean;
  changed: boolean;
  now: number;
  onSelect: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

const ChannelIcon = ({ channel }: { channel: Incident["channel"] }) => {
  if (channel === "PHONE") return <Phone size={12} aria-hidden="true" />;
  if (channel === "SMS") return <ChatText size={12} aria-hidden="true" />;
  return <GlobeHemisphereWest size={12} aria-hidden="true" />;
};

export function IncidentRow({
  incident,
  selected,
  changed,
  now,
  onSelect,
  buttonRef,
}: IncidentRowProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="incident-row"
      data-selected={selected || undefined}
      data-changed={changed || undefined}
      data-priority={incident.priority.toLowerCase()}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="incident-row-rail" aria-hidden="true" />
      <span className="incident-row-topline">
        <PriorityBadge priority={incident.priority} compact />
        <span className="incident-id">{incident.id}</span>
        <time className="elapsed-time" dateTime={incident.receivedAt}>{formatElapsed(incident.receivedAt, now)}</time>
      </span>
      <span className="incident-location">{incident.location.address}</span>
      <span className="incident-summary">{incident.summary}</span>
      <span className="incident-meta">
        <span className="channel-label"><ChannelIcon channel={incident.channel} /> {incident.channel}</span>
        <span className="caller-state" data-state={incident.callerConnection.toLowerCase()}>
          <Broadcast size={11} aria-hidden="true" /> {incident.callerConnection.toLowerCase()}
        </span>
        {incident.status === "FAILED" && (
          <span className="row-failure"><Warning size={12} /> Dispatch failed</span>
        )}
      </span>
      <span className="incident-row-footer">
        <span className="missing-info" data-clear={incident.missingFields.length === 0 || undefined}>
          {incident.missingFields.length > 0
            ? <><Warning size={12} /> Missing: {incident.missingFields[0]}</>
            : <>Critical fields complete</>}
        </span>
        {incident.claimedBy && <span className="claimed-by"><User size={12} /> {incident.claimedBy}</span>}
        {!incident.claimedBy && <span className="status-text">{formatIncidentStatus(incident.status)}</span>}
      </span>
    </button>
  );
}
