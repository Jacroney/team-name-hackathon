import { Languages, Radio } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "../../lib/schemas";

interface TranscriptProps {
  messages: TranscriptMessage[];
  highlightedFact?: string;
}

const speakerLabel: Record<TranscriptMessage["speaker"], string> = {
  CALLER: "Caller",
  AI: "Crisis Mesh AI",
  OPERATOR: "Operator",
};

export function Transcript({ messages, highlightedFact }: TranscriptProps) {
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!highlightedFact) return;
    const source = messages.find((message) => message.factIds.includes(highlightedFact));
    if (source) messageRefs.current[source.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedFact, messages]);

  return (
    <section className="workspace-section transcript-section">
      <div className="section-heading">
        <div><span className="eyebrow">CALLER SESSION</span><h2>Live transcript</h2></div>
        <span className="live-indicator"><Radio size={12} /> LIVE</span>
      </div>
      <div className="transcript-log" aria-live="polite">
        {messages.map((message) => {
          const highlighted = Boolean(highlightedFact && message.factIds.includes(highlightedFact));
          return (
            <div
              className="transcript-message"
              data-speaker={message.speaker.toLowerCase()}
              data-highlighted={highlighted || undefined}
              key={message.id}
              ref={(element) => { messageRefs.current[message.id] = element; }}
            >
              <div className="transcript-meta">
                <strong>{speakerLabel[message.speaker]}</strong>
                <time dateTime={message.timestamp}>
                  {new Date(message.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                </time>
              </div>
              {message.translated ? (
                <div className="translation-block">
                  <div className="translated-copy"><span>EN</span><p>{message.translated}</p></div>
                  <div className="original-copy">
                    <span><Languages size={12} /> {message.language ?? "Original"}</span>
                    <p>{message.original}</p>
                  </div>
                </div>
              ) : <p className="message-copy">{message.original}</p>}
              {highlighted && <span className="source-match">SOURCE FOR SELECTED FIELD</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
