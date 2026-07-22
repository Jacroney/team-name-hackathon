import type { Incident, Priority } from "./schemas";

const priorityOrder: Record<Priority, number> = {
  CRITICAL: 0,
  URGENT: 1,
  ROUTINE: 2,
  UNKNOWN: 3,
};

export const sortIncidents = (incidents: Incident[]): Incident[] =>
  [...incidents].sort((left, right) => {
    const severityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (severityDifference !== 0) return severityDifference;
    return Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
  });

export const formatElapsed = (receivedAt: string, now = Date.now()): string => {
  const totalSeconds = Math.max(0, Math.floor((now - Date.parse(receivedAt)) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const formatIncidentStatus = (status: Incident["status"]): string =>
  status.replaceAll("_", " ");
