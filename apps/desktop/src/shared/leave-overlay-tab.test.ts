import { beforeEach, describe, expect, test } from "vitest";

import { goBackOrHome, goHome, leaveAllOverlayTabs } from "./leave-overlay-tab";

import { useTabs } from "~/store/zustand/tabs";
import {
  createSessionTab,
  resetTabsStore,
} from "~/store/zustand/tabs/test-utils";

describe("folder chip navigation from overlays", () => {
  beforeEach(() => {
    resetTabsStore();
  });

  test("nested overlay (Settings -> Contacts) lands on the home tab", () => {
    const session = createSessionTab({ id: "home" });
    useTabs.getState().openNew(session);
    useTabs.getState().openNew({ type: "settings" });
    useTabs.getState().openNew({ type: "contacts" });
    expect(useTabs.getState().currentTab?.type).toBe("contacts");

    leaveAllOverlayTabs();

    expect(useTabs.getState().currentTab?.type).toBe("sessions");
  });

  test("single overlay (Settings) lands on the home tab", () => {
    const session = createSessionTab({ id: "home" });
    useTabs.getState().openNew(session);
    useTabs.getState().openNew({ type: "settings" });

    leaveAllOverlayTabs();

    expect(useTabs.getState().currentTab?.type).toBe("sessions");
  });

  test("orphaned Settings (no return origin) still reaches the home tab", () => {
    useTabs.getState().openNew({ type: "settings" });
    useTabs.getState().openNew({ type: "contacts" });
    expect(useTabs.getState().currentTab?.type).toBe("contacts");

    leaveAllOverlayTabs();

    expect(useTabs.getState().currentTab?.type).toBe("empty");
  });
});

describe("goHome (bouton Accueil, issue 315)", () => {
  beforeEach(() => {
    resetTabsStore();
  });

  test("ramène une note à l'accueil", () => {
    useTabs.getState().openNew(createSessionTab({ id: "s1" }));

    goHome();

    expect(useTabs.getState().currentTab?.type).toBe("empty");
  });

  test("ramène les réglages à l'accueil, même ouverts depuis une note", () => {
    useTabs.getState().openNew(createSessionTab({ id: "s1" }));
    useTabs.getState().openNew({ type: "settings" });

    goHome();

    expect(useTabs.getState().currentTab?.type).toBe("empty");
  });

  test("réutilise l'accueil déjà ouvert", () => {
    useTabs.getState().openNew({ type: "empty" });
    const homeSlot = useTabs.getState().currentTab?.slotId;
    useTabs.getState().openNew(createSessionTab({ id: "s1" }));

    goHome();

    expect(useTabs.getState().currentTab?.slotId).toBe(homeSlot);
    expect(
      useTabs.getState().tabs.filter((t) => t.type === "empty"),
    ).toHaveLength(1);
  });

  test("ne fait rien sur l'accueil", () => {
    useTabs.getState().openNew({ type: "empty" });
    const before = useTabs.getState().currentTab;

    goHome();

    expect(useTabs.getState().currentTab).toBe(before);
  });
});

describe("goBackOrHome (Alt+←, issue 315)", () => {
  beforeEach(() => {
    resetTabsStore();
  });

  test("revient à l'écran précédent quand l'historique le permet", () => {
    useTabs.getState().openNew({ type: "empty" });
    useTabs.getState().openCurrent(createSessionTab({ id: "s1" }));
    useTabs.getState().openCurrent(createSessionTab({ id: "s2" }));

    goBackOrHome();

    const current = useTabs.getState().currentTab;
    expect(current?.type === "sessions" && current.id).toBe("s1");

    goBackOrHome();

    expect(useTabs.getState().currentTab?.type).toBe("empty");
  });

  test("ramène à l'accueil sans historique", () => {
    useTabs.getState().openNew(createSessionTab({ id: "s1" }));
    expect(useTabs.getState().canGoBack).toBe(false);

    goBackOrHome();

    expect(useTabs.getState().currentTab?.type).toBe("empty");
  });
});
