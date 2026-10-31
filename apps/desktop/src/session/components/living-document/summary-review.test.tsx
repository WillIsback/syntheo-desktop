import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyProposalReview: vi.fn((_id: string, _client?: unknown) =>
    Promise.resolve(),
  ),
  declineProposalReview: vi.fn((_id: string, _client?: unknown) =>
    Promise.resolve(),
  ),
  proposals: [] as Array<Record<string, unknown>>,
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("~/session/queries", () => ({
  usePendingSessionProposals: () => mocks.proposals,
}));

vi.mock("~/session/proposal-review", async () => {
  const actual = await vi.importActual<
    typeof import("~/session/proposal-review")
  >("~/session/proposal-review");
  return {
    ...actual,
    applyProposalReview: mocks.applyProposalReview,
    declineProposalReview: mocks.declineProposalReview,
  };
});

import { SummaryProposalReview, useSummaryProposal } from "./summary-review";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";

const proposal = {
  id: "request-1",
  currentMarkdown: "## Décisions\n\n- Livrer lundi\n- Garder le budget",
  proposedMarkdown: "## Décisions\n\n- Livrer lundi",
};

describe("SummaryProposalReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the proposal as a readable diff, not raw markdown", () => {
    render(<SummaryProposalReview proposal={proposal} />);

    const review = screen.getByRole("region", {
      name: "Proposed summary edit",
    });
    expect(review.querySelector("del")?.textContent).toContain(
      "- Garder le budget",
    );
    expect(review.querySelector("ins")).toBeNull();
    // Chaque bloc passe par le rendu markdown, pas un <pre> de diff brut.
    expect(review.querySelectorAll("[data-testid='markdown']").length).toBe(2);
    expect(review.querySelector("pre")).toBeNull();
    expect(review.querySelector("del")?.className).toContain("line-through");
    expect(review.className).not.toMatch(/italic/);
  });

  it("applies or declines the proposal from the note", async () => {
    render(<SummaryProposalReview proposal={proposal} />);

    fireEvent.click(screen.getByRole("button", { name: "Apply to summary" }));
    await waitFor(() => {
      expect(mocks.applyProposalReview).toHaveBeenCalledWith(
        "request-1",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      expect(mocks.declineProposalReview).toHaveBeenCalledWith(
        "request-1",
        expect.anything(),
      );
    });
  });

  it("shows a translated error when the review cannot be saved", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.applyProposalReview.mockRejectedValueOnce(
      new Error("Raw English failure"),
    );
    render(<SummaryProposalReview proposal={proposal} />);

    fireEvent.click(screen.getByRole("button", { name: "Apply to summary" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This edit could not be saved. Try again.",
    );
    consoleError.mockRestore();
  });
});

describe("useSummaryProposal", () => {
  beforeEach(() => {
    usePendingEditStore.setState({ edits: new Map() });
    mocks.proposals = [];
  });

  it("follows a chat proposal waiting for approval on the shown summary", () => {
    usePendingEditStore.getState().addEdit({
      requestId: "request-1",
      sessionId: "session-1",
      target: { kind: "summary", enhancedNoteId: "summary-1" },
      currentContent: "Avant",
      proposedContent: "Après",
      source: "chat",
      resolve: vi.fn(),
    });

    const { result } = renderHook(() =>
      useSummaryProposal("session-1", "summary-1"),
    );
    expect(result.current).toEqual({
      id: "request-1",
      currentMarkdown: "Avant",
      proposedMarkdown: "Après",
    });

    const other = renderHook(() =>
      useSummaryProposal("session-1", "summary-2"),
    );
    expect(other.result.current).toBeNull();
  });

  it("falls back to a stored pending proposal (CLI, MCP, after a restart)", () => {
    mocks.proposals = [
      {
        id: "proposal-1",
        sessionId: "session-1",
        kind: "summary_replace",
        targetId: "summary-1",
        status: "pending",
        currentMarkdown: "Avant",
        proposedMarkdown: "Après",
      },
    ];

    const { result } = renderHook(() =>
      useSummaryProposal("session-1", "summary-1"),
    );
    expect(result.current).toEqual({
      id: "proposal-1",
      currentMarkdown: "Avant",
      proposedMarkdown: "Après",
    });
  });
});
