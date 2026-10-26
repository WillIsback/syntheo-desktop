import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { DeepLink } from "@anlg/plugin-deeplink2";

const mocks = vi.hoisted(() => ({
  handler: null as ((deepLink: DeepLink) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@anlg/plugin-deeplink2", () => ({
  commands: {
    takePendingDeepLinks: vi.fn(async () => ({ status: "ok", data: [] })),
  },
  events: {
    deepLinkEvent: {
      listen: vi.fn(
        async (listener: (event: { payload: DeepLink }) => void) => {
          mocks.handler = (payload) => listener({ payload });
          return () => {};
        },
      ),
    },
  },
}));
vi.mock("~/onboarding/welcome-note", () => ({
  stopActiveWelcomeDemo: vi.fn(async () => undefined),
}));

import { useDeeplinkHandler } from "./useDeeplinkHandler";

afterEach(() => {
  mocks.handler = null;
  vi.clearAllMocks();
});

// Aucun module d'authentification simulé ni AuthProvider : Syntheo n'a pas
// de compte, les jetons d'un ancien lien de connexion sont ignorés.
it("auth_callback_tokens_are_ignored", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  renderHook(() => useDeeplinkHandler());
  await waitFor(() => expect(mocks.handler).not.toBeNull());

  const callback = {
    to: "/auth/callback",
    search: { access_token: "access", refresh_token: "refresh" },
  } as unknown as DeepLink;
  expect(() => mocks.handler!(callback)).not.toThrow();
  await Promise.resolve();

  expect(consoleError).not.toHaveBeenCalled();

  consoleError.mockRestore();
});
