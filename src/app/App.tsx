import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const updateTimers = useRef(new Map<string, number>());

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
    if (incidentId || !incidentsQuery.data?.length) return;
    if (!window.matchMedia("(max-width: 800px)").matches) {
      const first = sortIncidents(incidentsQuery.data)[0];
      void navigate(`/incidents/${first.id}`, { replace: true });
    }
  }, [incidentId, incidentsQuery.data, navigate]);

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
  const activeCount = incidents.filter((item) => item.status !== "CLOSED").length;
  const feedWarning = connectionStatus === "stale" || connectionStatus === "disconnected";

  const workspace = incidentId ? (
    detailQuery.isLoading ? <WorkspaceLoading /> : detailQuery.isError || !incident ? (
      <WorkspaceEmpty onRetry={() => void detailQuery.refetch()} />
    ) : (
      <>
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
    )
  ) : <WorkspaceEmpty />;

  return (
    <AppShell
      selected={Boolean(incidentId)}
      activeCount={activeCount}
      connectionStatus={connectionStatus}
      onMobileBack={() => void navigate("/incidents")}
      queue={
        <IncidentQueue
          incidents={incidents}
          selectedId={incidentId}
          updatedIds={updatedIds}
          loading={incidentsQuery.isLoading}
          error={incidentsQuery.error instanceof Error ? incidentsQuery.error.message : undefined}
          onSelect={(id) => void navigate(`/incidents/${id}`)}
          onRetry={() => void incidentsQuery.refetch()}
        />
      }
      workspace={workspace}
      decision={incident ? <DispatchPanel incident={incident} /> : <WorkspaceEmpty />}
    />
  );
}
