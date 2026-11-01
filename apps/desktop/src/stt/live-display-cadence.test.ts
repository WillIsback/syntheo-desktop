import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLiveDisplayCadence,
  LIVE_DISPLAY_INTERVAL_MS,
  LIVE_DISPLAY_TYPING_INTERVAL_MS,
  NOTE_TYPING_WINDOW_MS,
  resetNoteTypingForTests,
} from "./live-display-cadence";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function typeInNotes() {
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  editor.contentEditable = "true";
  const paragraph = document.createElement("p");
  editor.append(paragraph);
  document.body.append(editor);
  paragraph.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  editor.remove();
}

// Simule le flux natif : un événement toutes les `everyMs` pendant
// `durationMs`, chacun appliqué aussitôt à l'état (ici un compteur), et
// chaque battement d'affichage relit l'état courant.
function streamDeltas(
  cadence: { request: () => void },
  applied: number[],
  { everyMs, durationMs }: { everyMs: number; durationMs: number },
) {
  for (let elapsed = 0; elapsed < durationMs; elapsed += everyMs) {
    applied.push(applied.length);
    cadence.request();
    vi.advanceTimersByTime(everyMs);
  }
}

describe("rythme d'affichage de la transcription en direct", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNoteTypingForTests();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dérive 4 battements par seconde, 2 pendant la frappe", () => {
    expect(LIVE_DISPLAY_INTERVAL_MS).toBe(250);
    expect(LIVE_DISPLAY_TYPING_INTERVAL_MS).toBe(500);
    expect(NOTE_TYPING_WINDOW_MS).toBe(800);
  });

  it("20 deltas en une seconde donnent au plus 5 affichages", () => {
    const flushes: number[] = [];
    const applied: number[] = [];
    const cadence = createLiveDisplayCadence(() =>
      flushes.push(applied.length),
    );

    streamDeltas(cadence, applied, { everyMs: 50, durationMs: 1_000 });

    expect(applied).toHaveLength(20);
    expect(flushes.length).toBeGreaterThanOrEqual(4);
    expect(flushes.length).toBeLessThanOrEqual(5);
    cadence.dispose();
  });

  it("n'attend pas un battement entier après un silence", () => {
    const flush = vi.fn();
    const cadence = createLiveDisplayCadence(flush);

    cadence.request();
    vi.advanceTimersByTime(0);
    expect(flush).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    cadence.request();
    vi.advanceTimersByTime(0);
    expect(flush).toHaveBeenCalledTimes(2);
    cadence.dispose();
  });

  it("ralentit à 2 affichages par seconde pendant la frappe dans les notes", () => {
    const flushes: number[] = [];
    const applied: number[] = [];
    const cadence = createLiveDisplayCadence(() =>
      flushes.push(applied.length),
    );

    for (let elapsed = 0; elapsed < 2_000; elapsed += 50) {
      if (elapsed % 200 === 0) typeInNotes();
      applied.push(applied.length);
      cadence.request();
      vi.advanceTimersByTime(50);
    }

    // 2 s de frappe : au plus 2 battements par seconde (+ le premier).
    expect(flushes.length).toBeLessThanOrEqual(5);
    expect(flushes.length).toBeGreaterThanOrEqual(3);
    cadence.dispose();
  });

  it("reprend le rythme normal 800 ms après la dernière frappe", () => {
    const flush = vi.fn();
    const cadence = createLiveDisplayCadence(flush);
    typeInNotes();
    vi.advanceTimersByTime(NOTE_TYPING_WINDOW_MS + 1);

    const applied: number[] = [];
    streamDeltas(cadence, applied, { everyMs: 50, durationMs: 1_000 });

    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(4);
    cadence.dispose();
  });

  it("ignore les frappes hors de l'éditeur de notes", () => {
    const flush = vi.fn();
    const cadence = createLiveDisplayCadence(flush);
    const input = document.createElement("input");
    document.body.append(input);
    const applied: number[] = [];

    for (let elapsed = 0; elapsed < 1_000; elapsed += 50) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
      applied.push(applied.length);
      cadence.request();
      vi.advanceTimersByTime(50);
    }

    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(4);
    input.remove();
    cadence.dispose();
  });

  it("n'affiche rien fenêtre masquée et vide tout d'un coup au retour", () => {
    const flushes: number[] = [];
    const applied: number[] = [];
    const cadence = createLiveDisplayCadence(() =>
      flushes.push(applied.length),
    );

    setHidden(true);
    streamDeltas(cadence, applied, { everyMs: 50, durationMs: 3_000 });
    expect(flushes).toEqual([]);

    setHidden(false);
    vi.advanceTimersByTime(0);
    // Un seul affichage, qui voit les 60 deltas appliqués.
    expect(flushes).toEqual([60]);
    cadence.dispose();
  });

  it("le dernier affichage voit toujours le dernier delta", () => {
    const flushes: number[] = [];
    const applied: number[] = [];
    const cadence = createLiveDisplayCadence(() =>
      flushes.push(applied.length),
    );

    streamDeltas(cadence, applied, { everyMs: 30, durationMs: 1_000 });
    vi.advanceTimersByTime(LIVE_DISPLAY_TYPING_INTERVAL_MS);

    expect(flushes.at(-1)).toBe(applied.length);
    // Chaque affichage voit au moins autant de deltas que le précédent.
    expect(flushes).toEqual([...flushes].sort((a, b) => a - b));
    cadence.dispose();
  });

  it("n'affiche plus rien une fois arrêté", () => {
    const flush = vi.fn();
    const cadence = createLiveDisplayCadence(flush);
    cadence.request();
    cadence.dispose();
    vi.advanceTimersByTime(1_000);
    setHidden(false);
    expect(flush).not.toHaveBeenCalled();
  });
});
