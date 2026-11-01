import { describe, expect, it, vi } from "vitest";

import {
  registerPreparedNoteStart,
  startPreparedNoteFromShortcut,
} from "./start-shortcut";

describe("start-shortcut", () => {
  it("does nothing when no note is being prepared", () => {
    expect(startPreparedNoteFromShortcut()).toBe(false);
  });

  it("starts the prepared note until it unregisters", () => {
    const start = vi.fn();
    const unregister = registerPreparedNoteStart(start);

    expect(startPreparedNoteFromShortcut()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);

    unregister();
    expect(startPreparedNoteFromShortcut()).toBe(false);
  });

  it("keeps the newest note when an older one unregisters late", () => {
    const older = vi.fn();
    const newer = vi.fn();
    const unregisterOlder = registerPreparedNoteStart(older);
    const unregisterNewer = registerPreparedNoteStart(newer);

    unregisterOlder();
    expect(startPreparedNoteFromShortcut()).toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();

    unregisterNewer();
  });
});
