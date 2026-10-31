import { describe, expect, it } from "vitest";

import {
  getLivingDocumentView,
  getLivingDocumentViews,
  getNoteStage,
  type NoteStage,
} from "./stage";

import type { SessionMode } from "~/store/zustand/listener/general";

describe("getNoteStage", () => {
  it.each<[string, SessionMode, boolean, boolean, NoteStage]>([
    ["note neuve", "inactive", false, false, "prepare"],
    ["écoute en cours", "active", false, false, "listen"],
    ["écoute reprise sur une note terminée", "active", true, true, "listen"],
    ["finalisation", "finalizing", true, false, "listen"],
    ["transcription différée", "running_batch", false, false, "synthesis"],
    ["transcription disponible", "inactive", true, false, "synthesis"],
    ["compte-rendu sans transcription", "inactive", false, true, "synthesis"],
  ])("%s", (_label, sessionMode, hasTranscript, hasEnhancedNotes, stage) => {
    expect(getNoteStage({ sessionMode, hasTranscript, hasEnhancedNotes })).toBe(
      stage,
    );
  });
});

describe("getLivingDocumentView", () => {
  it("affiche les notes de l'utilisateur avant et pendant l'écoute", () => {
    const view = { type: "enhanced", id: "n1" } as const;
    expect(getLivingDocumentView("prepare", view, ["n1"])).toEqual({
      type: "raw",
    });
    expect(getLivingDocumentView("listen", view, ["n1"])).toEqual({
      type: "raw",
    });
  });

  it("affiche le compte-rendu choisi, sinon le premier, pour la synthèse", () => {
    expect(
      getLivingDocumentView("synthesis", { type: "enhanced", id: "n2" }, [
        "n1",
        "n2",
      ]),
    ).toEqual({ type: "enhanced", id: "n2" });
    expect(
      getLivingDocumentView("synthesis", { type: "transcript" }, ["n1"]),
    ).toEqual({ type: "enhanced", id: "n1" });
    expect(getLivingDocumentView("synthesis", { type: "raw" }, ["n1"])).toEqual(
      { type: "enhanced", id: "n1" },
    );
  });

  it("retombe sur les notes quand aucun compte-rendu n'existe", () => {
    expect(getLivingDocumentView("synthesis", null, [])).toEqual({
      type: "raw",
    });
    expect(getLivingDocumentViews([])).toEqual([{ type: "raw" }]);
    expect(getLivingDocumentViews(["a", "b"])).toEqual([
      { type: "enhanced", id: "a" },
      { type: "enhanced", id: "b" },
    ]);
  });
});
