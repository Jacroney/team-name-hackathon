import { describe, expect, it } from "vitest";
import { demoIncidents } from "./demoData";
import { formatElapsed, sortIncidents } from "./incidentUtils";

describe("incident queue ordering", () => {
  it("sorts by severity and then longest waiting time", () => {
    const sorted = sortIncidents(demoIncidents);

    expect(sorted.slice(0, 3).map((incident) => incident.priority)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "CRITICAL",
    ]);
    expect(sorted[0].id).toBe("CM-0722-0017");
    expect(sorted.at(-1)?.priority).toBe("ROUTINE");
  });

  it("formats elapsed time for operator scanning", () => {
    const receivedAt = new Date("2026-07-22T14:00:00.000Z").toISOString();
    const now = Date.parse("2026-07-22T14:18:09.000Z");

    expect(formatElapsed(receivedAt, now)).toBe("18:09");
  });
});
