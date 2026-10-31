import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applySessionProposal: vi.fn(),
  declineSessionProposal: vi.fn(),
  close: vi.fn(),
  openNew: vi.fn(),
  tabs: [] as Array<Record<string, unknown>>,
  currentTab: null as Record<string, unknown> | null,
  updateSessionTabState: vi.fn(),
  sessionMode: "inactive" as string,
  invalidateQueries: vi.fn(),
}));

vi.mock("~/session/queries", () => ({
  applySessionProposal: mocks.applySessionProposal,
  declineSessionProposal: mocks.declineSessionProposal,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: {
    getState: () => ({
      tabs: mocks.tabs,
      currentTab: mocks.currentTab,
      close: mocks.close,
      openNew: mocks.openNew,
      updateSessionTabState: mocks.updateSessionTabState,
    }),
  },
}));

vi.mock("~/store/zustand/listener/instance", () => ({
  listenerStore: {
    getState: () => ({ getSessionMode: () => mocks.sessionMode }),
  },
}));

import {
  applyProposalReview,
  closeProposalReviewTab,
  declineProposalReview,
  diffMarkdownLines,
  openProposalReview,
  proposalKindLabel,
  revealSummaryReviewInNote,
  reviewPendingProposal,
  shouldAutoDeclineProposal,
} from "./proposal-review";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";

describe("proposal review helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingEditStore.setState({ edits: new Map() });
    mocks.tabs = [
      {
        type: "edit",
        requestId: "proposal-1",
        slotId: "slot-1",
      },
    ];
    mocks.applySessionProposal.mockResolvedValue(undefined);
    mocks.declineSessionProposal.mockResolvedValue(undefined);
  });

  it("does not auto-decline CLI or MCP proposals", () => {
    expect(shouldAutoDeclineProposal("chat")).toBe(true);
    expect(shouldAutoDeclineProposal(undefined)).toBe(true);
    expect(shouldAutoDeclineProposal("cli")).toBe(false);
    expect(shouldAutoDeclineProposal("mcp")).toBe(false);
  });

  it("labels memo and summary proposal kinds", () => {
    expect(proposalKindLabel("memo_replace")).toBe("memo");
    expect(proposalKindLabel("summary_replace")).toBe("summary");
  });

  it("opens and closes the review tab by request id", () => {
    openProposalReview("proposal-1");
    expect(mocks.openNew).toHaveBeenCalledWith({
      type: "edit",
      requestId: "proposal-1",
    });

    closeProposalReviewTab("proposal-1");
    expect(mocks.close).toHaveBeenCalledWith(mocks.tabs[0]);
  });

  it("applies, resolves waiters, and closes the review tab", async () => {
    const resolve = vi.fn();
    usePendingEditStore.getState().addEdit({
      requestId: "proposal-1",
      sessionId: "session-1",
      target: { kind: "memo" },
      currentContent: "",
      proposedContent: "Agenda",
      source: "chat",
      resolve,
    });

    await applyProposalReview("proposal-1", {
      invalidateQueries: mocks.invalidateQueries,
    } as never);

    expect(mocks.applySessionProposal).toHaveBeenCalledWith("proposal-1");
    expect(resolve).toHaveBeenCalledWith(true);
    expect(mocks.close).toHaveBeenCalledWith(mocks.tabs[0]);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["session-proposals"],
    });
    expect(usePendingEditStore.getState().edits.has("proposal-1")).toBe(false);
  });

  it("declines without applying the meeting write", async () => {
    const resolve = vi.fn();
    usePendingEditStore.getState().addEdit({
      requestId: "proposal-1",
      sessionId: "session-1",
      target: { kind: "memo" },
      currentContent: "",
      proposedContent: "Agenda",
      source: "cli",
      resolve,
    });

    await declineProposalReview("proposal-1");

    expect(mocks.declineSessionProposal).toHaveBeenCalledWith("proposal-1");
    expect(resolve).toHaveBeenCalledWith(false);
    expect(mocks.applySessionProposal).not.toHaveBeenCalled();
  });
});

describe("summary review in the living document", () => {
  const sessionTab = {
    type: "sessions",
    id: "session-1",
    slotId: "slot-1",
    active: true,
    state: { view: null, autoStart: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentTab = sessionTab;
    mocks.sessionMode = "inactive";
  });

  it("shows the reviewed summary in the open note", () => {
    expect(revealSummaryReviewInNote("session-1", "summary-2")).toBe(true);
    expect(mocks.updateSessionTabState).toHaveBeenCalledWith(sessionTab, {
      view: { type: "enhanced", id: "summary-2" },
      autoStart: null,
    });
  });

  it("keeps the review tab when the note is not on screen", () => {
    mocks.currentTab = { ...sessionTab, id: "session-other" };
    expect(revealSummaryReviewInNote("session-1", "summary-2")).toBe(false);

    mocks.currentTab = { type: "edit", requestId: "r", slotId: "s" };
    expect(revealSummaryReviewInNote("session-1", "summary-2")).toBe(false);
    expect(mocks.updateSessionTabState).not.toHaveBeenCalled();
  });

  it("keeps the review tab while the note is listening", () => {
    mocks.sessionMode = "active";
    expect(revealSummaryReviewInNote("session-1", "summary-2")).toBe(false);
  });

  it("reviews a summary proposal in place from the banner", () => {
    reviewPendingProposal({
      id: "proposal-1",
      sessionId: "session-1",
      kind: "summary_replace",
      targetId: "summary-2",
    });
    expect(mocks.updateSessionTabState).toHaveBeenCalled();
    expect(mocks.openNew).not.toHaveBeenCalled();

    reviewPendingProposal({
      id: "proposal-2",
      sessionId: "session-1",
      kind: "memo_replace",
      targetId: "session-1",
    });
    expect(mocks.openNew).toHaveBeenCalledWith({
      type: "edit",
      requestId: "proposal-2",
    });
  });
});

describe("diffMarkdownLines", () => {
  it("groups unchanged, removed and added lines in reading order", () => {
    expect(
      diffMarkdownLines(
        "## Décisions\n\n- A\n- B\n- C\n\n## Actions",
        "## Décisions\n\n- A\n- C bis\n\n## Actions",
      ),
    ).toEqual([
      { type: "same", text: "## Décisions\n\n- A" },
      { type: "removed", text: "- B\n- C" },
      { type: "added", text: "- C bis" },
      { type: "same", text: "\n## Actions" },
    ]);
  });

  it("handles an empty current summary", () => {
    expect(diffMarkdownLines("", "Nouveau")).toEqual([
      { type: "added", text: "Nouveau" },
    ]);
  });
});
