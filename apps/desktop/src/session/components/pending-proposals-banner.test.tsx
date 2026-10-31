import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePendingSessionProposals: vi.fn(),
  reviewPendingProposal: vi.fn(),
}));

vi.mock("~/session/queries", () => ({
  usePendingSessionProposals: mocks.usePendingSessionProposals,
}));

vi.mock("~/session/proposal-review", async () => {
  const actual = await vi.importActual<
    typeof import("~/session/proposal-review")
  >("~/session/proposal-review");
  return {
    ...actual,
    reviewPendingProposal: mocks.reviewPendingProposal,
  };
});

import { PendingProposalsBanner } from "./pending-proposals-banner";

describe("PendingProposalsBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides when the meeting has no pending proposals", () => {
    mocks.usePendingSessionProposals.mockReturnValue([]);

    const { container } = render(
      <PendingProposalsBanner sessionId="session-1" />,
    );

    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reviews a pending summary proposal (in the note when it is open)", () => {
    mocks.usePendingSessionProposals.mockReturnValue([
      {
        id: "proposal-1",
        sessionId: "session-1",
        kind: "summary_replace",
        targetId: "summary-1",
      },
    ]);

    render(<PendingProposalsBanner sessionId="session-1" />);

    expect(screen.getByText("1 pending edit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review summary" }));
    expect(mocks.reviewPendingProposal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proposal-1", targetId: "summary-1" }),
    );
  });
});
