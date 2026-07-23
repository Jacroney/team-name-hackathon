import { FunnelSimple, ArrowsClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { sortIncidents } from "../../lib/incidentUtils";
import type { Incident, Priority } from "../../lib/schemas";
import { IncidentRow } from "./IncidentRow";

interface IncidentQueueProps {
  incidents: Incident[];
  selectedId?: string;
  updatedIds: Set<string>;
  loading: boolean;
  error?: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

type QueueFilter = Priority | "ALL";

const filterLabels: Array<{ value: QueueFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "CRITICAL", label: "Critical" },
  { value: "URGENT", label: "Urgent" },
  { value: "ROUTINE", label: "Routine" },
];

export function IncidentQueue({
  incidents,
  selectedId,
  updatedIds,
  loading,
  error,
  onSelect,
  onRetry,
}: IncidentQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(Date.now());
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleIncidents = sortIncidents(incidents).filter((incident) => {
    if (filter !== "ALL" && incident.priority !== filter) return false;
    if (!normalizedSearch) return true;
    return [incident.id, incident.location.address, incident.summary]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
  });

  const counts: Record<QueueFilter, number> = {
    ALL: incidents.length,
    CRITICAL: incidents.filter((incident) => incident.priority === "CRITICAL").length,
    URGENT: incidents.filter((incident) => incident.priority === "URGENT").length,
    ROUTINE: incidents.filter((incident) => incident.priority === "ROUTINE").length,
    UNKNOWN: incidents.filter((incident) => incident.priority === "UNKNOWN").length,
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "/" && event.target !== searchRef.current) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const focusedIndex = rowRefs.current.findIndex((row) => row === document.activeElement);
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(focusedIndex + 1, visibleIncidents.length - 1)
      : Math.max(focusedIndex < 0 ? visibleIncidents.length - 1 : focusedIndex - 1, 0);
    rowRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="incident-queue" onKeyDown={handleKeyDown}>
      <div className="column-heading">
        <div>
          <span className="eyebrow">JURISDICTION 04</span>
          <h1>Incidents</h1>
        </div>
        <button className="icon-button" type="button" aria-label="Queue options"><FunnelSimple size={16} /></button>
      </div>

      <div className="queue-counts" aria-label="Filter incidents by severity">
        {filterLabels.map((item) => (
          <button
            type="button"
            key={item.value}
            aria-label={`${item.label} ${counts[item.value]}`}
            data-filter={item.value.toLowerCase()}
            data-active={filter === item.value || undefined}
            onClick={() => setFilter(item.value)}
          >
            <span>{item.label}</span>
            <strong>{counts[item.value]}</strong>
          </button>
        ))}
      </div>

      <label className="queue-search">
        <MagnifyingGlass size={14} aria-hidden="true" />
        <span className="sr-only">Search incidents</span>
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search ID, address, summary"
        />
        <kbd>/</kbd>
      </label>

      <div className="queue-sort-label">
        <span>SEVERITY / WAIT TIME</span>
        <span>{visibleIncidents.length} SHOWN</span>
      </div>

      <div className="incident-list" role="list" aria-busy={loading}>
        {loading && Array.from({ length: 5 }, (_, index) => <div className="queue-skeleton" key={index} />)}
        {error && (
          <div className="queue-error" role="alert">
            <strong>Queue unavailable</strong>
            <span>{error}</span>
            <button type="button" className="button secondary" onClick={onRetry}><ArrowsClockwise size={14} /> Retry</button>
          </div>
        )}
        {!loading && !error && visibleIncidents.map((incident, index) => (
          <div role="listitem" key={incident.id}>
            <IncidentRow
              incident={incident}
              selected={incident.id === selectedId}
              changed={updatedIds.has(incident.id)}
              now={now}
              onSelect={() => onSelect(incident.id)}
              buttonRef={(element) => { rowRefs.current[index] = element; }}
            />
          </div>
        ))}
        {!loading && !error && visibleIncidents.length === 0 && (
          <div className="empty-queue">No incidents match this view.</div>
        )}
      </div>
    </div>
  );
}
