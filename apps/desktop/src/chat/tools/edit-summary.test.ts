import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSessionContentSnapshot: vi.fn(),
  persistChatSessionProposal: vi.fn(),
  applySessionProposal: vi.fn(),
  declineSessionProposal: vi.fn(),
  revealSummaryReviewInNote: vi.fn(
    (_sessionId: string, _noteId: string) => false,
  ),
}));

vi.mock("~/session/proposal-review", () => ({
  revealSummaryReviewInNote: mocks.revealSummaryReviewInNote,
}));

vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: mocks.loadSessionContentSnapshot,
}));

vi.mock("~/session/queries", () => ({
  persistChatSessionProposal: mocks.persistChatSessionProposal,
  applySessionProposal: mocks.applySessionProposal,
  declineSessionProposal: mocks.declineSessionProposal,
}));

import { buildEditSummaryTool } from "./edit-summary";

import { usePendingEditStore } from "~/chat/tools/pending-edit-store";

describe("edit summary chat tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingEditStore.setState({ edits: new Map() });
    mocks.persistChatSessionProposal.mockResolvedValue(undefined);
    mocks.applySessionProposal.mockResolvedValue(undefined);
    mocks.declineSessionProposal.mockResolvedValue(undefined);
    mocks.loadSessionContentSnapshot.mockResolvedValue({
      enhancedNotes: [
        {
          id: "summary-1",
          title: "Summary",
          markdown: "Current summary",
          templateId: "",
          position: 0,
        },
      ],
    });
  });

  it("persists a proposal and applies it after review", async () => {
    const openEditTab = vi.fn((requestId: string) => {
      const pending = usePendingEditStore.getState().edits.get(requestId);
      expect(pending).toMatchObject({
        sessionId: "session-1",
        target: { kind: "summary", enhancedNoteId: "summary-1" },
        currentContent: "Current summary",
        proposedContent: "Updated summary",
        source: "chat",
      });
      usePendingEditStore.getState().resolveEdit(requestId, true);
    });
    const editTool = buildEditSummaryTool({
      getSessionId: () => "session-1",
      getEnhancedNoteId: () => undefined,
      openEditTab,
    });

    await expect(
      (editTool as any).execute(
        { content: "Updated summary" },
        { toolCallId: "request-1", messages: [] },
      ),
    ).resolves.toEqual({ status: "applied" });

    expect(mocks.persistChatSessionProposal).toHaveBeenCalledWith({
      id: "request-1",
      sessionId: "session-1",
      kind: "summary_replace",
      targetId: "summary-1",
      currentMarkdown: "Current summary",
      proposedMarkdown: "Updated summary",
    });
    expect(openEditTab).toHaveBeenCalledWith("request-1");
    expect(mocks.applySessionProposal).toHaveBeenCalledWith("request-1");
  });

  it("declines the persisted proposal when review is rejected", async () => {
    const editTool = buildEditSummaryTool({
      getSessionId: () => "session-1",
      getEnhancedNoteId: () => undefined,
      openEditTab: (requestId) => {
        usePendingEditStore.getState().resolveEdit(requestId, false);
      },
    });

    await expect(
      (editTool as any).execute(
        { content: "Updated summary" },
        { toolCallId: "request-1", messages: [] },
      ),
    ).resolves.toEqual({ status: "declined" });

    expect(mocks.declineSessionProposal).toHaveBeenCalledWith("request-1");
    expect(mocks.applySessionProposal).not.toHaveBeenCalled();
  });

  it("returns actionable candidates when the requested summary is unrelated and no summary is on screen", async () => {
    const editTool = buildEditSummaryTool({
      // L'onglet affiché est une autre note : rien à quoi se rabattre.
      getSessionId: () => "session-other",
      getEnhancedNoteId: () => undefined,
      openEditTab: vi.fn(),
    });

    await expect(
      (editTool as any).execute(
        {
          sessionId: "session-1",
          enhancedNoteId: "summary-other",
          content: "Updated summary",
        },
        { toolCallId: "request-1", messages: [] },
      ),
    ).resolves.toEqual({
      status: "error",
      code: "summary_not_in_session",
      message:
        'Summary "summary-other" does not belong to session session-1. Retry with one of these enhancedNoteId values, or omit enhancedNoteId to edit the summary the user is viewing: "summary-1" (Summary).',
      candidates: [
        {
          enhancedNoteId: "summary-1",
          title: "Summary",
          position: 0,
        },
      ],
    });
    expect(mocks.persistChatSessionProposal).not.toHaveBeenCalled();
  });

  describe("summary shown in the living document", () => {
    beforeEach(() => {
      mocks.loadSessionContentSnapshot.mockResolvedValue({
        enhancedNotes: [
          {
            id: "summary-template",
            title: "Point d'équipe",
            markdown: "Template summary",
            templateId: "template-1",
            position: 0,
          },
          {
            id: "summary-default",
            title: "Summary",
            markdown: "Default summary",
            templateId: "",
            position: 1,
          },
        ],
      });
    });

    function buildTool(getEnhancedNoteId: () => string | undefined) {
      return buildEditSummaryTool({
        getSessionId: () => "session-1",
        getEnhancedNoteId,
        openEditTab: (requestId) => {
          usePendingEditStore.getState().resolveEdit(requestId, true);
        },
      });
    }

    it("targets the summary on screen when the tab has no explicit view", async () => {
      // Le document vivant montre le premier compte-rendu quand la vue de
      // l'onglet est vide (ou raw / transcript, hérités de l'ancienne vue).
      await (buildTool(() => undefined) as any).execute(
        { content: "Shorter" },
        { toolCallId: "request-1", messages: [] },
      );

      expect(mocks.persistChatSessionProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: "summary-template",
          currentMarkdown: "Template summary",
        }),
      );
    });

    it("ignores a stale view id and targets the summary on screen", async () => {
      await (buildTool(() => "summary:session-1") as any).execute(
        { content: "Shorter" },
        { toolCallId: "request-1", messages: [] },
      );

      expect(mocks.persistChatSessionProposal).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: "summary-template" }),
      );
    });

    it("falls back to the summary on screen when the model passes a wrong id", async () => {
      // Le modèle ne voit que « Session ID » dans son contexte : il le passe
      // souvent comme enhancedNoteId.
      await expect(
        (buildTool(() => "summary-default") as any).execute(
          { enhancedNoteId: "session-1", content: "Shorter" },
          { toolCallId: "request-1", messages: [] },
        ),
      ).resolves.toEqual({ status: "applied" });

      expect(mocks.persistChatSessionProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: "summary-default",
          currentMarkdown: "Default summary",
        }),
      );
    });

    it("reviews the proposal in the note instead of opening a review tab", async () => {
      mocks.revealSummaryReviewInNote.mockReturnValueOnce(true);
      const openEditTab = vi.fn();
      const editTool = buildEditSummaryTool({
        getSessionId: () => "session-1",
        getEnhancedNoteId: () => undefined,
        openEditTab,
      });

      const pending = (editTool as any).execute(
        { content: "Shorter" },
        { toolCallId: "request-1", messages: [] },
      );
      await vi.waitFor(() => {
        expect(usePendingEditStore.getState().edits.has("request-1")).toBe(
          true,
        );
      });
      usePendingEditStore.getState().resolveEdit("request-1", false);

      await expect(pending).resolves.toEqual({ status: "declined" });
      expect(mocks.revealSummaryReviewInNote).toHaveBeenCalledWith(
        "session-1",
        "summary-template",
      );
      expect(openEditTab).not.toHaveBeenCalled();
    });
  });
});
