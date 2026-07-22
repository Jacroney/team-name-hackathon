import type { Activity } from "../../lib/schemas";

export function ActivityTimeline({ activity }: { activity: Activity[] }) {
  return (
    <section className="workspace-section activity-section">
      <div className="section-heading compact">
        <div><span className="eyebrow">AUDIT TRAIL</span><h2>Activity</h2></div>
      </div>
      <ol className="activity-list">
        {[...activity].reverse().map((item) => (
          <li key={item.id}>
            <span className="timeline-dot" aria-hidden="true" />
            <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
            <div><strong>{item.action}</strong><span>{item.actor}{item.detail ? ` · ${item.detail}` : ""}</span></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
