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
    expect(screen.getByText(/Missing: Sprinkler activation unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("CM-0722-0017"));
    expect(onSelect).toHaveBeenCalledWith("CM-0722-0017");
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

    fireEvent.click(screen.getByRole("button", { name: /Routine 4/ }));
    expect(screen.queryByText("CM-0722-0017")).not.toBeInTheDocument();
    expect(screen.getByText("CM-0722-0102")).toBeInTheDocument();
  });
});
