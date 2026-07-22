import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { demoIncidents } from "../../lib/demoData";
import { IncidentQueue } from "./IncidentQueue";

describe("IncidentQueue", () => {
  it("shows written severity, missing information, and allows selection", () => {
    const onSelect = vi.fn();
    render(
      <IncidentQueue
        incidents={demoIncidents}
        updatedIds={new Set()}
        loading={false}
        onSelect={onSelect}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getAllByText("Critical", { selector: ".priority-badge" })[0]).toBeInTheDocument();
    expect(screen.getByText(/Missing: Occupant headcount unconfirmed/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("FN-2048"));
    expect(onSelect).toHaveBeenCalledWith("FN-2048");
  });

  it("filters by written severity", () => {
    render(
      <IncidentQueue
        incidents={demoIncidents}
        updatedIds={new Set()}
        loading={false}
        onSelect={() => undefined}
        onRetry={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Routine 2/ }));
    expect(screen.queryByText("FN-2048")).not.toBeInTheDocument();
    expect(screen.getByText("FN-2045")).toBeInTheDocument();
  });
});
