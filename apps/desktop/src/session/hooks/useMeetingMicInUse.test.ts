import { describe, expect, it } from "vitest";

import { micAppsShowInUse } from "./useMeetingMicInUse";

describe("micAppsShowInUse", () => {
  it("treats a non-self app as the meeting mic", () => {
    expect(micAppsShowInUse([{ id: "us.zoom.xos", name: "Zoom" }])).toBe(true);
  });

  it("ignores Syntheo itself", () => {
    expect(
      micAppsShowInUse([
        { id: "com.syntheo.app", name: "Syntheo" },
        { id: "com.syntheo.app", name: "Syntheo" },
      ]),
    ).toBe(false);
  });

  it("ignores empty, pid, and duplicate ids", () => {
    expect(
      micAppsShowInUse([
        { id: "", name: "" },
        { id: "pid:1234", name: "Unknown" },
      ]),
    ).toBe(false);
    expect(
      micAppsShowInUse([
        { id: "us.zoom.xos", name: "Zoom" },
        { id: "us.zoom.xos", name: "Zoom" },
      ]),
    ).toBe(true);
  });
});
