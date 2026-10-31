import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMeetingTypeTemplates, PrepareFiche } from "./fiche";

import type { UserTemplate } from "~/templates";

const mocks = vi.hoisted(() => ({
  rawTemplateId: "",
  templates: [] as unknown[],
  spokenLanguages: ["fr"] as unknown,
}));

vi.mock(
  "~/session/components/outer-header/metadata/participants/input",
  () => ({
    ParticipantInput: () => <input aria-label="Add participants" />,
  }),
);

vi.mock("~/session/queries", () => ({
  useSession: () => ({ raw_template_id: mocks.rawTemplateId }),
}));

vi.mock("~/templates", () => ({
  useUserTemplates: () => mocks.templates,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.spokenLanguages,
}));

function template(id: string, extra: Partial<UserTemplate> = {}): UserTemplate {
  return {
    id,
    title: id,
    pinned: false,
    sections: [],
    ...extra,
  } as unknown as UserTemplate;
}

describe("getMeetingTypeTemplates", () => {
  it("lists the selected template, favourites, then defaults, without duplicates", () => {
    const templates = [
      template("default-daily-standup"),
      template("fav-b", { pinned: true, pinOrder: 2 }),
      template("fav-a", { pinned: true, pinOrder: 1 }),
      template("custom"),
      template("default-one-on-one-meeting"),
    ];

    expect(
      getMeetingTypeTemplates(templates, "custom").map(({ id }) => id),
    ).toEqual([
      "custom",
      "fav-a",
      "fav-b",
      "default-daily-standup",
      "default-one-on-one-meeting",
    ]);
    expect(
      getMeetingTypeTemplates(templates, "fav-b").map(({ id }) => id),
    ).toEqual([
      "fav-b",
      "fav-a",
      "default-daily-standup",
      "default-one-on-one-meeting",
    ]);
  });
});

describe("PrepareFiche", () => {
  beforeEach(() => {
    mocks.rawTemplateId = "";
    mocks.templates = [template("default-daily-standup", { title: "Point" })];
    mocks.spokenLanguages = ["fr"];
  });

  afterEach(() => {
    cleanup();
  });

  it("shows type, participants and listening sources", () => {
    render(<PrepareFiche sessionId="s" onSelectTemplate={vi.fn()} />);

    expect(screen.getByText("Type")).not.toBeNull();
    expect(screen.getByText("Participants")).not.toBeNull();
    expect(screen.getByText("Listening")).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Add participants" })).not.toBe(
      null,
    );
    expect(screen.getByText("Mic")).not.toBeNull();
    expect(screen.getByText("Computer audio")).not.toBeNull();
    expect(screen.getByText("French")).not.toBeNull();
  });

  it("marks the chosen type and changes it on click", () => {
    const onSelectTemplate = vi.fn();
    render(<PrepareFiche sessionId="s" onSelectTemplate={onSelectTemplate} />);

    const automatic = screen.getByRole("button", { name: "Automatic" });
    const point = screen.getByRole("button", { name: "Point" });
    expect(automatic.getAttribute("aria-pressed")).toBe("true");
    expect(point.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(point);
    expect(onSelectTemplate).toHaveBeenCalledWith("default-daily-standup");
  });
});
