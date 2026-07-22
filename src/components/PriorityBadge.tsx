import type { Priority } from "../lib/schemas";

interface PriorityBadgeProps {
  priority: Priority;
  compact?: boolean;
}

const labels: Record<Priority, string> = {
  CRITICAL: "Critical",
  URGENT: "Urgent",
  ROUTINE: "Routine",
  UNKNOWN: "Unknown",
};

export function PriorityBadge({ priority, compact = false }: PriorityBadgeProps) {
  return (
    <span className="priority-badge" data-priority={priority.toLowerCase()} data-compact={compact || undefined}>
      <span className="priority-marker" aria-hidden="true" />
      {labels[priority]}
    </span>
  );
}
