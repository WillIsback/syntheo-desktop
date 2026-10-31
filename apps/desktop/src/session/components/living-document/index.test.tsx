import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LivingDocument, type LivingDocumentProps } from "./index";

import type { Tab } from "~/store/zustand/tabs";

const mocks = vi.hoisted(() => ({
  rawMounts: 0,
  enhancedContent: "## Décisions" as string | undefined,
  enhanceStatus: "success" as string,
  updateSession: vi.fn(() => Promise.resolve()),
  proposal: null as null | {
    id: string;
    currentMarkdown: string;
    proposedMarkdown: string;
  },
}));

vi.mock("./summary-review", () => ({
  useSummaryProposal: () => mocks.proposal,
  SummaryProposalReview: (props: { proposal: { id: string } }) => (
    <div data-testid="summary-review">{props.proposal.id}</div>
  ),
}));

vi.mock("./living-document.css", () => ({}));

vi.mock("../note-input/raw", () => ({
  RawEditor: (props: { placeholder?: string }) => {
    useEffect(() => {
      mocks.rawMounts += 1;
    }, []);
    return <div data-testid="raw-editor">{props.placeholder}</div>;
  },
}));

vi.mock("../note-input/enhanced", () => ({
  Enhanced: (props: { enhancedNoteId: string }) => (
    <div data-testid="enhanced-editor">{props.enhancedNoteId}</div>
  ),
}));

vi.mock("../title-input", () => ({
  TitleInput: (props: { variant?: string }) => (
    <input aria-label="Session title" data-variant={props.variant} />
  ),
}));

vi.mock("./fiche", () => ({
  PrepareFiche: (props: { onSelectTemplate: (id: string) => void }) => (
    <button type="button" onClick={() => props.onSelectTemplate("tpl-1")}>
      Fiche
    </button>
  ),
}));

vi.mock("./meta", () => ({
  NoteMeta: (props: { children?: React.ReactNode }) => (
    <div data-testid="note-meta">{props.children}</div>
  ),
}));

vi.mock("./summary-switcher", () => ({
  SummarySwitcher: () => null,
}));

vi.mock("~/session/components/note-input/transcript", () => ({
  Transcript: () => <div data-testid="transcript" />,
}));

vi.mock("~/ai/hooks", () => ({
  useAITaskTask: () => ({ status: mocks.enhanceStatus }),
}));

vi.mock("~/session/queries", () => ({
  useEnhancedNote: () => ({ content: mocks.enhancedContent }),
  useSession: () => ({ raw_md: '{"type":"doc"}' }),
  useUpdateSession: () => mocks.updateSession,
}));

vi.mock("~/session/editor-activity", () => ({
  registerCanonicalSessionEditor: vi.fn(),
  unregisterCanonicalSessionEditor: vi.fn(),
}));

const tab = {
  type: "sessions",
  id: "session-1",
  active: true,
  pinned: false,
  slotId: "slot-1",
  state: { view: null, autoStart: null },
} as Extract<Tab, { type: "sessions" }>;

function makeProps(
  overrides: Partial<LivingDocumentProps> = {},
): LivingDocumentProps {
  return {
    tab,
    stage: "prepare",
    sessionMode: "inactive",
    rawMd: "",
    sessionTitle: "Point d'équipe",
    editorTabs: [{ type: "raw" }],
    currentTab: { type: "raw" },
    onSelectView: vi.fn(),
    editorRef: createRef(),
    scrollRef: createRef(),
    onContainerMouseDown: vi.fn(),
    onViewReady: vi.fn(),
    onViewDisposed: vi.fn(),
    transcriptEditMode: false,
    ...overrides,
  };
}

describe("LivingDocument", () => {
  beforeEach(() => {
    mocks.rawMounts = 0;
    mocks.enhancedContent = "## Décisions";
    mocks.enhanceStatus = "success";
    mocks.updateSession.mockClear();
    mocks.proposal = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("prepares: serif title, fiche and a free notes area in a 760px column", () => {
    render(<LivingDocument {...makeProps()} />);

    expect(
      screen
        .getByRole("textbox", { name: "Session title" })
        .getAttribute("data-variant"),
    ).toBe("document");
    expect(screen.getByRole("button", { name: "Fiche" })).not.toBeNull();
    expect(screen.getByTestId("raw-editor").textContent).toContain(
      "Note here what you want to remember",
    );
    expect(document.querySelector("[data-transcript-margin]")).toBeNull();
    expect(document.querySelector(".max-w-\\[760px\\]")).not.toBeNull();
  });

  it("stores the meeting type as the summary template", () => {
    render(<LivingDocument {...makeProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Fiche" }));

    expect(mocks.updateSession).toHaveBeenCalledWith({
      raw_md: '{"type":"doc"}',
      raw_template_id: "tpl-1",
    });
  });

  it("listens: notes on the left, scrolling transcript in a 280px margin", () => {
    const view = render(<LivingDocument {...makeProps()} />);
    view.rerender(
      <LivingDocument
        {...makeProps({ stage: "listen", sessionMode: "active" })}
      />,
    );

    const margin = screen.getByRole("complementary", { name: "Transcription" });
    expect(margin.querySelector("[data-testid='transcript']")).not.toBeNull();
    expect(
      document.querySelector(".grid-cols-\\[minmax\\(0\\,1fr\\)_280px\\]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Fiche" })).toBeNull();
    // Le même éditeur de notes reste monté entre Préparer et Écouter.
    expect(mocks.rawMounts).toBe(1);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("synthesises: provenance, generated text in foreground, user notes in user-ink and seal", () => {
    render(
      <LivingDocument
        {...makeProps({
          stage: "synthesis",
          editorTabs: [{ type: "enhanced", id: "note-1" }],
          currentTab: { type: "enhanced", id: "note-1" },
        })}
      />,
    );

    expect(screen.getByText("Your notes", { selector: "span" })).not.toBeNull();
    expect(screen.getByText("Completed by Syntheo")).not.toBeNull();
    expect(
      screen.getByTestId("enhanced-editor").closest("[data-provenance='ai']"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("raw-editor").closest("[data-provenance='user']"),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Your notes" })).not.toBeNull();
    expect(document.querySelector("[data-note-seal]")).not.toBeNull();
  });

  it("keeps the full transcript reachable from the margin after the meeting", () => {
    render(
      <LivingDocument
        {...makeProps({
          stage: "synthesis",
          editorTabs: [{ type: "enhanced", id: "note-1" }],
          currentTab: { type: "enhanced", id: "note-1" },
          onTranscriptEditModeChange: vi.fn(),
        })}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Transcription" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-transcript-margin]")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("complementary", { name: "Transcription" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).not.toBeNull();
  });

  it("waits for the summary to finish before sealing it", () => {
    mocks.enhanceStatus = "generating";
    render(
      <LivingDocument
        {...makeProps({
          stage: "synthesis",
          editorTabs: [{ type: "enhanced", id: "note-1" }],
          currentTab: { type: "enhanced", id: "note-1" },
        })}
      />,
    );

    expect(document.querySelector("[data-note-seal]")).toBeNull();
  });

  it("reviews a pending summary edit in place of the summary", () => {
    mocks.proposal = {
      id: "request-1",
      currentMarkdown: "Avant",
      proposedMarkdown: "Après",
    };
    render(
      <LivingDocument
        {...makeProps({
          stage: "synthesis",
          editorTabs: [{ type: "enhanced", id: "note-1" }],
          currentTab: { type: "enhanced", id: "note-1" },
        })}
      />,
    );

    const review = screen.getByTestId("summary-review");
    expect(review.textContent).toBe("request-1");
    expect(review.closest("[data-provenance='ai']")).not.toBeNull();
    expect(screen.queryByTestId("enhanced-editor")).toBeNull();
    // Les notes de l'utilisateur restent visibles sous la revue ; pas de sceau
    // tant que la proposition attend.
    expect(screen.getAllByTestId("raw-editor")).toHaveLength(1);
    expect(document.querySelector("[data-note-seal]")).toBeNull();
  });

  it("shows only the user notes when no summary exists", () => {
    render(<LivingDocument {...makeProps({ stage: "synthesis" })} />);

    expect(screen.queryByTestId("enhanced-editor")).toBeNull();
    expect(screen.getAllByTestId("raw-editor")).toHaveLength(1);
    expect(document.querySelector("[data-note-seal]")).toBeNull();
  });
});
