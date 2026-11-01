import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PrepareFiche } from "./fiche";

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

describe("PrepareFiche", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= vi.fn();
  });

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

  it("shows the chosen type and changes it from the searchable picker", () => {
    const onSelectTemplate = vi.fn();
    render(<PrepareFiche sessionId="s" onSelectTemplate={onSelectTemplate} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Meeting type: Automatic" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search a meeting type" }),
      { target: { value: "poi" } },
    );
    fireEvent.click(screen.getByRole("option", { name: "Point" }));

    expect(onSelectTemplate).toHaveBeenCalledWith("default-daily-standup");
  });

  it("shows the title of the session's template", () => {
    mocks.rawTemplateId = "default-daily-standup";
    render(<PrepareFiche sessionId="s" onSelectTemplate={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Meeting type: Point" }),
    ).toBeTruthy();
  });
});
