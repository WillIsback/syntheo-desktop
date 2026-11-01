import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playSfx: vi.fn(),
  stopSfx: vi.fn(),
  setSfxVolume: vi.fn(),
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "linux",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@syntheo/plugin-sfx", () => ({
  commands: {
    play: mocks.playSfx,
    stop: mocks.stopSfx,
    setVolume: mocks.setSfxVolume,
  },
}));

vi.mock("./calendar", () => ({ CalendarSection: () => null }));
vi.mock("./imports", () => ({
  ImportSection: () => <div data-testid="import-section" />,
}));
vi.mock("./permissions", () => ({ PermissionsSection: () => null }));
vi.mock("./final", () => ({
  FinalDescription: () => null,
  FinalSection: () => null,
  finishOnboarding: vi.fn(),
}));

vi.mock("~/shared/window-shell", () => ({
  StandaloneWindowShell: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: vi.fn(),
}));

import { StandaloneOnboardingScreen } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.playSfx.mockResolvedValue(null);
  mocks.stopSfx.mockResolvedValue(null);
  mocks.setSfxVolume.mockResolvedValue(null);
});

afterEach(cleanup);

it("affiche l'accueil guidé sur un fond uni, sans vidéo ni flou (issue 320)", () => {
  const { container } = render(
    <StandaloneOnboardingScreen onFinish={vi.fn()} />,
  );

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Welcome to Syntheo",
  );
  expect(screen.getByTestId("import-section")).toBeTruthy();

  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector("source")).toBeNull();
  expect(container.querySelector("[class*='backdrop-blur']")).toBeNull();

  const root = container.firstElementChild;
  expect(root?.className).toContain("bg-background");
});
