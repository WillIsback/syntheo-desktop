import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MeetingTypePicker } from "./meeting-type-picker";

import type { UserTemplate } from "~/templates";

const mocks = vi.hoisted(() => ({ openTemplatesTab: vi.fn() }));

vi.mock("~/templates/use-open-templates-tab", () => ({
  useOpenTemplatesTab: () => mocks.openTemplatesTab,
}));

function template(id: string, extra: Partial<UserTemplate> = {}): UserTemplate {
  return {
    id,
    title: id,
    description: "",
    pinned: false,
    sections: [],
    ...extra,
  } as unknown as UserTemplate;
}

const templates = [
  template("standup", { title: "Point quotidien" }),
  template("fav-b", { title: "Bilan", pinned: true, pinOrder: 2 }),
  template("fav-a", { title: "Zénith", pinned: true, pinOrder: 1 }),
  template("kickoff", {
    title: "Lancement",
    description: "Cadrer un nouveau projet",
  }),
  template("sales", { title: "Découverte", targets: ["Commercial"] }),
];

function renderPicker(selectedTemplateId = "", onSelect = vi.fn()) {
  render(
    <MeetingTypePicker
      templates={templates}
      selectedTemplateId={selectedTemplateId}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: /Meeting type/ }));
  return screen.getByRole("combobox", { name: "Search a meeting type" });
}

function optionNames() {
  return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("MeetingTypePicker", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.openTemplatesTab.mockReset();
  });

  it("shows the current type on the trigger", () => {
    renderPicker("kickoff");
    expect(
      screen.getByRole("button", { name: "Meeting type: Lancement" }),
    ).toBeTruthy();
    cleanup();

    renderPicker("");
    expect(
      screen.getByRole("button", { name: "Meeting type: Automatic" }),
    ).toBeTruthy();
  });

  it("groups types: default, favourites in pin order, then all alphabetically", () => {
    renderPicker();
    const input = open();

    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("listbox")).toBeTruthy();

    expect(
      within(screen.getByRole("group", { name: "Default" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Automatic"]);
    expect(
      within(screen.getByRole("group", { name: "My favorites" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Zénith", "Bilan"]);
    expect(
      within(screen.getByRole("group", { name: "All templates" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Découverte", "Lancement", "Point quotidien"]);
    expect(optionNames()[0]).toBe("Automatic");
  });

  it("filters on title, description and « Used for »", () => {
    renderPicker();
    const input = open();

    fireEvent.change(input, { target: { value: "projet" } });
    expect(optionNames()).toEqual(["Lancement"]);

    fireEvent.change(input, { target: { value: "commercial" } });
    expect(optionNames()).toEqual(["Découverte"]);

    fireEvent.change(input, { target: { value: "zén" } });
    expect(optionNames()).toEqual(["Zénith"]);

    fireEvent.change(input, { target: { value: "introuvable" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No meeting type found")).toBeTruthy();
  });

  it("selects with the mouse and closes", () => {
    const { onSelect } = renderPicker();
    open();

    fireEvent.click(screen.getByRole("option", { name: "Bilan" }));

    expect(onSelect).toHaveBeenCalledWith("fav-b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("chooses « Automatic » as an empty template id", () => {
    const { onSelect } = renderPicker("kickoff");
    open();

    fireEvent.click(screen.getByRole("option", { name: "Automatic" }));

    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("navigates with the arrows and validates with Enter", () => {
    const { onSelect } = renderPicker();
    const input = open();

    const active = () =>
      document.getElementById(input.getAttribute("aria-activedescendant") ?? "")
        ?.textContent;

    expect(active()).toBe("Automatic");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("Zénith");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("Découverte");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(active()).toBe("Bilan");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("fav-b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks the current type and activates the first match after a search", () => {
    renderPicker("kickoff");
    const input = open();
    const active = () =>
      document.getElementById(input.getAttribute("aria-activedescendant") ?? "")
        ?.textContent;

    const current = screen.getAllByRole("img", { name: "Current type" });
    expect(current).toHaveLength(1);
    expect(current[0]!.closest("[role='option']")?.textContent).toBe(
      "Lancement",
    );

    fireEvent.change(input, { target: { value: "point" } });
    expect(active()).toBe("Point quotidien");
  });

  it("closes on Escape without choosing", () => {
    const { onSelect } = renderPicker();
    const input = open();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the template editor from « Manage templates »", () => {
    renderPicker("kickoff");
    open();

    fireEvent.click(screen.getByRole("button", { name: "Manage templates" }));

    expect(mocks.openTemplatesTab).toHaveBeenCalledWith({
      showHomepage: false,
      isWebMode: false,
      selectedMineId: "kickoff",
      selectedWebIndex: null,
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
