import { Camera, FileText, Headphones, Play, Video } from "lucide-react";
import type { Evidence } from "../../lib/schemas";

const EvidenceIcon = ({ type }: { type: Evidence["type"] }) => {
  if (type === "PHOTO") return <Camera size={19} />;
  if (type === "AUDIO") return <Headphones size={19} />;
  if (type === "VIDEO") return <Video size={19} />;
  return <FileText size={19} />;
};

export function EvidenceGallery({ evidence }: { evidence: Evidence[] }) {
  return (
    <section className="workspace-section evidence-section">
      <div className="section-heading compact">
        <div><span className="eyebrow">ATTACHMENTS</span><h2>Evidence</h2></div>
        <span className="section-count">{evidence.length}</span>
      </div>
      {evidence.length === 0 ? (
        <div className="section-empty">No evidence received.</div>
      ) : (
        <div className="evidence-grid">
          {evidence.map((item, index) => (
            <a className="evidence-item" href={item.url} target={item.url ? "_blank" : undefined} rel={item.url ? "noreferrer" : undefined} key={item.id}>
              <span className="evidence-preview" data-type={item.type.toLowerCase()}>
                <EvidenceIcon type={item.type} />
                {item.type === "AUDIO" && (
                  <span className="audio-wave" aria-hidden="true">
                    {Array.from({ length: 11 }, (_, bar) => <i key={bar} style={{ height: `${6 + (bar * 7) % 15}px` }} />)}
                  </span>
                )}
                {item.type === "AUDIO" && <Play className="play-icon" size={17} />}
              </span>
              <span className="evidence-copy">
                <strong>{item.label}</strong>
                <small>{item.type} {String(index + 1).padStart(2, "0")}{item.durationSeconds ? ` · ${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : ""}</small>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
