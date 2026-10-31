import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/shared/main", () => ({
  StandardContentWrapper: ({
    children,
    floatingButton,
  }: {
    children: React.ReactNode;
    floatingButton?: React.ReactNode;
  }) => (
    <div>
      {children}
      {floatingButton}
    </div>
  ),
}));

vi.mock("~/home", () => ({
  HomePage: () => <div data-testid="home-page" />,
}));

import { TabContentEmpty } from "./empty";

describe("TabContentEmpty", () => {
  afterEach(() => {
    cleanup();
  });

  it("affiche l'accueil guidé, sans le bouton de chat flottant", () => {
    render(
      <TabContentEmpty
        tab={{
          active: true,
          pinned: false,
          slotId: "slot-home",
          type: "empty",
        }}
      />,
    );

    expect(screen.getByTestId("home-page")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Ask Syntheo anything" }),
    ).toBeNull();
  });
});
