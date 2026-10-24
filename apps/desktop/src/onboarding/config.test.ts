import { beforeEach, describe, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ platform: "linux" as string }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => os.platform }));

import { getInitialStep, getNextStep, type OnboardingStep } from "./config";

function walk(): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  let step: OnboardingStep | null = getInitialStep();
  while (step) {
    steps.push(step);
    step = getNextStep(step);
  }
  return steps;
}

describe("onboarding steps", () => {
  beforeEach(() => {
    os.platform = "linux";
  });

  it("onboarding_never_shows_login", () => {
    for (const platform of ["macos", "linux", "windows"]) {
      os.platform = platform;
      expect(walk()).not.toContain("login");
    }
  });

  it("offers the Apple Calendar step on macOS only", () => {
    os.platform = "macos";
    expect(walk()).toEqual(["permissions", "calendar", "imports", "final"]);
    os.platform = "linux";
    expect(walk()).toEqual(["imports", "final"]);
  });
});
