import { Button } from "@cloudflare/kumo/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { DispatchPanel } from "../features/incidents/DispatchPanel";
import { IncidentQueue } from "../features/incidents/IncidentQueue";
import {
  IncidentWorkspace,
  WorkspaceEmpty,
  WorkspaceLoading,
} from "../features/incidents/IncidentWorkspace";
import { RegionMap } from "../features/incidents/RegionMap";
import { SelectedIncidentPanel } from "../features/incidents/SelectedIncidentPanel";
import { getIncident, listIncidents } from "../lib/api";
import { sortIncidents } from "../lib/incidentUtils";
import { connectIncidentStream, type RealtimeStatus } from "../lib/realtime";
import { incidentSchema, type Incident, type RealtimeEvent } from "../lib/schemas";

const mergeIncidentPatch = (
  current: Incident,
  event: Extract<RealtimeEvent, { type: "incident.patch" }>,
): Incident => {
  if (event.version <= current.version) return current;
  return incidentSchema.parse({ ...current, ...event.patch, id: current.id, version: event.version });
};

export function App() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<RealtimeStatus>("connecting");
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(() => new Set());
  const [mapSelectedId, setMapSelectedId] = useState<string>();
  const updateTimers = useRef(new Map<string, number>());

  // A report is open when the route targets a specific incident; otherwise we show the map.
  const reportOpen = Boolean(incidentId);
  const selectedId = incidentId ?? mapSelectedId;

  const incidentsQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: listIncidents,
    staleTime: 15_000,
    retry: 1,
  });

  const detailQuery = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => getIncident(incidentId ?? ""),
    enabled: Boolean(incidentId),
    placeholderData: () => incidentsQuery.data?.find((incident) => incident.id === incidentId),
    staleTime: 5_000,
    retry: 1,
  });

  useEffect(() => {
    if (mapSelectedId || incidentId || !incidentsQuery.data?.length) return;
    setMapSelectedId(sortIncidents(incidentsQuery.data)[0].id);
  }, [mapSelectedId, incidentId, incidentsQuery.data]);

  useEffect(() => {
    const flashUpdated = (id: string): void => {
      setUpdatedIds((current) => new Set(current).add(id));
      const existingTimer = updateTimers.current.get(id);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        setUpdatedIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        updateTimers.current.delete(id);
      }, 1_500);
      updateTimers.current.set(id, timer);
    };

    const handleRealtimeEvent = (event: RealtimeEvent): void => {
      if (event.type === "heartbeat") return;
      if (event.type === "incident.created") {
        queryClient.setQueryData<Incident[]>(["incidents"], (current = []) =>
          sortIncidents([event.incident, ...current.filter((item) => item.id !== event.incident.id)]));
        queryClient.setQueryData(["incident", event.incident.id], event.incident);
        flashUpdated(event.incident.id);
        return;
      }

      if (event.type === "presence") {
        queryClient.setQueryData<Incident[]>(["incidents"], (current = []) => current.map((incident) =>
          incident.id === event.incidentId ? { ...incident, viewers: event.viewers } : incident));
        queryClient.setQueryData<Incident>(["incident", event.incidentId], (current) =>
          current ? { ...current, viewers: event.viewers } : current);
        return;
      }

      queryClient.setQueryData<Incident[]>(["incidents"], (current = []) => sortIncidents(current.map((incident) =>
        incident.id === event.incidentId ? mergeIncidentPatch(incident, event) : incident)));
      queryClient.setQueryData<Incident>(["incident", event.incidentId], (current) =>
        current ? mergeIncidentPatch(current, event) : current);
      flashUpdated(event.incidentId);
    };

    const disconnect = connectIncidentStream({
      jurisdictionId: import.meta.env.VITE_JURISDICTION_ID ?? "metro-central",
      onEvent: handleRealtimeEvent,
      onStatus: setConnectionStatus,
    });

    return () => {
      disconnect();
      updateTimers.current.forEach((timer) => window.clearTimeout(timer));
      updateTimers.current.clear();
    };
  }, [queryClient]);

  const incidents = incidentsQuery.data ?? [];
  const incident = detailQuery.data;
  const selectedIncident = incidents.find((item) => item.id === selectedId);
  const activeCount = incidents.filter((item) => item.status !== "CLOSED").length;
  const feedWarning = connectionStatus === "stale" || connectionStatus === "disconnected";

  const openReport = (id: string): void => {
    setMapSelectedId(id);
    void navigate(`/incidents/${id}`);
  };
  const backToMap = (): void => {
    if (incidentId) setMapSelectedId(incidentId);
    void navigate("/incidents");
  };
  const handleQueueSelect = (id: string): void => {
    if (reportOpen) void navigate(`/incidents/${id}`);
    else setMapSelectedId(id);
  };

  const reportBody = detailQuery.isLoading ? (
    <WorkspaceLoading />
  ) : detailQuery.isError || !incident ? (
    <WorkspaceEmpty onRetry={() => void detailQuery.refetch()} />
  ) : (
    <>
      <div className="report-toolbar">
        <Button variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={backToMap}>
          Back to map
        </Button>
      </div>
      {feedWarning && (
        <div className="feed-warning" role="alert">
          <WifiOff size={15} />
          {connectionStatus === "stale"
            ? "Live updates are stale. Verify incident version before acting."
            : "Live connection lost. Reconnecting; API actions remain version-checked."}
        </div>
      )}
      <IncidentWorkspace incident={incident} />
    </>
  );

  const workspace = reportOpen ? (
    reportBody
  ) : (
    <RegionMap
      incidents={incidents}
      selectedId={selectedId}
      onSelect={setMapSelectedId}
      onOpenReport={openReport}
    />
  );

  const decision = reportOpen ? (
    incident ? <DispatchPanel incident={incident} /> : <WorkspaceEmpty />
  ) : (
    <SelectedIncidentPanel incident={selectedIncident} onOpenReport={openReport} />
  );

  return (
    <AppShell
      selected={reportOpen}
      activeCount={activeCount}
      connectionStatus={connectionStatus}
      onMobileBack={() => void navigate("/incidents")}
      queue={
        <IncidentQueue
          incidents={incidents}
          selectedId={selectedId}
          updatedIds={updatedIds}
          loading={incidentsQuery.isLoading}
          error={incidentsQuery.error instanceof Error ? incidentsQuery.error.message : undefined}
          onSelect={handleQueueSelect}
          onRetry={() => void incidentsQuery.refetch()}
        />
      }
      workspace={workspace}
      decision={decision}
    />
  );
}
