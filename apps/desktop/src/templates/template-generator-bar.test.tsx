import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  model: { modelId: "test" } as unknown,
  status: { status: "success" } as { status: string },
  generateTemplate: vi.fn(),
}));

vi.mock("~/ai/hooks", () => ({
  useLanguageModel: () => mocks.model,
  useLLMConnectionStatus: () => mocks.status,
}));

vi.mock("./generator", () => ({ generateTemplate: mocks.generateTemplate }));

import { TemplateGeneratorBar } from "./template-generator-bar";

afterEach(cleanup);

function generateButton() {
  return screen.getByRole("button", {
    name: /Suggest sections/,
  }) as HTMLButtonElement;
}

describe("TemplateGeneratorBar", () => {
  beforeEach(() => {
    mocks.model = { modelId: "test" };
    mocks.status = { status: "success" };
    mocks.generateTemplate.mockReset();
  });

  it("désactive la génération sans modèle connecté", () => {
    mocks.status = { status: "pending" };
    render(<TemplateGeneratorBar onGenerated={vi.fn()} />);

    expect(generateButton().disabled).toBe(true);
  });

  it("génère et remonte le template", async () => {
    const onGenerated = vi.fn();
    mocks.generateTemplate.mockResolvedValue({
      title: "Point projet",
      description: "",
      category: "Projet",
      icon: { type: "icon", value: "kanban", color: "#1a73e8" },
      sections: [{ title: "Avancement", description: "a" }],
    });

    render(<TemplateGeneratorBar onGenerated={onGenerated} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Describe the meeting" }),
      {
        target: { value: "point projet" },
      },
    );
    fireEvent.click(generateButton());

    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Point projet" }),
      ),
    );
  });

  it("utilise le nom et la description du modèle quand le champ est vide", async () => {
    mocks.generateTemplate.mockResolvedValue({
      title: "Comité",
      description: "",
      category: "",
      icon: { type: "icon", value: "kanban", color: "#1a73e8" },
      sections: [{ title: "Décisions", description: "d" }],
    });

    render(
      <TemplateGeneratorBar
        context="Comité de direction. Réunion mensuelle"
        onGenerated={vi.fn()}
      />,
    );
    fireEvent.click(generateButton());

    await waitFor(() =>
      expect(mocks.generateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "Comité de direction. Réunion mensuelle",
        }),
      ),
    );
  });

  it("explique quoi faire quand le serveur de synthèse ne répond pas", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateTemplate.mockRejectedValue(new Error("ECONNREFUSED"));

    render(<TemplateGeneratorBar context="Point" onGenerated={vi.fn()} />);
    fireEvent.click(generateButton());

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /did not respond/,
    );
  });
});
