import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingActionButton } from "./index";

import type { Tab } from "~/store/zustand/tabs";
import type { EditorView } from "~/store/zustand/tabs/schema";

const hoisted = vi.hoisted(() => ({
  chatMode: "FloatingClosed" as string,
  capsuleProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../capsule/session-capsule", () => ({
  SessionCapsule: (props: Record<string, unknown>) => {
    hoisted.capsuleProps.push(props);
    return (
      <div role="group" aria-label="Note capsule">
        {String(props.stage)}
      </div>
    );
  },
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({ chat: { mode: hoisted.chatMode } }),
}));

describe("FloatingActionButton", () => {
  const tab = {
    type: "sessions",
    id: "session-1",
    active: true,
    pinned: false,
    slotId: "slot-1",
    state: { view: null, autoStart: null },
  } as Extract<Tab, { type: "sessions" }>;

  const renderFloatingActionButton = (
    props: Partial<React.ComponentProps<typeof FloatingActionButton>> = {},
  ) =>
    render(
      <FloatingActionButton
        currentView={{ type: "raw" } as EditorView}
        stage="prepare"
        tab={tab}
        {...props}
      />,
    );

  beforeEach(() => {
    hoisted.chatMode = "FloatingClosed";
    hoisted.capsuleProps = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the capsule instead of the « Ask anything » bar", () => {
    renderFloatingActionButton({ stage: "listen" });

    expect(screen.getByRole("group", { name: "Note capsule" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Ask Syntheo anything" }),
    ).toBeNull();
    expect(hoisted.capsuleProps[hoisted.capsuleProps.length - 1]).toMatchObject(
      {
        stage: "listen",
        tab,
        standaloneWindow: false,
      },
    );
  });

  it("keeps a selection slot stacked above the capsule", () => {
    renderFloatingActionButton();

    const slot = document.querySelector("[data-session-fab-selection]");
    const stack = slot?.parentElement;

    expect(stack?.className).toContain("flex-col-reverse");
    expect(stack?.className).toContain("bottom-[22px]");
    expect(slot?.className).toContain("mb-2");
  });

  it("hides the capsule while the floating chat covers it", () => {
    hoisted.chatMode = "FloatingOpen";
    renderFloatingActionButton({ stage: "synthesis" });

    const capsuleHost = document.querySelector(".peer\\/session-fab");
    expect(capsuleHost?.className).toContain("invisible");
    expect(capsuleHost?.getAttribute("aria-hidden")).toBe("true");
  });
});
