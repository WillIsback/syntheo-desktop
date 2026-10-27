import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.hoisted(() => vi.fn());
const generateText = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({ generateObject, generateText }));

import { generateTemplate } from "./generator";

const model = {} as never;

describe("generateTemplate", () => {
  beforeEach(() => {
    generateObject.mockReset();
    generateText.mockReset();
  });

  it("retourne un template structuré", async () => {
    generateObject.mockResolvedValue({
      object: {
        title: "Point projet",
        description: "Avancement et blocages",
        category: "Projet",
        icon: "kanban",
        sections: [
          { title: "Avancement", description: "a" },
          { title: "Blocages", description: "b" },
          { title: "Prochaines étapes", description: "c" },
        ],
      },
    });

    const result = await generateTemplate({ model, input: "point projet" });

    expect(result.title).toBe("Point projet");
    expect(result.sections).toHaveLength(3);
    expect(result.icon).toMatchObject({ type: "icon", value: "kanban" });
  });

  it("replie sur le Markdown si le JSON structuré échoue", async () => {
    generateObject.mockRejectedValue(new Error("no structured output"));
    generateText.mockResolvedValue({
      text: "# Fait\nCe qui est fait.\n# En cours\nCe qui est en cours.\n# Bloquants\nLes blocages.",
    });

    const result = await generateTemplate({ model, input: "standup" });

    expect(result.sections.map((section) => section.title)).toEqual([
      "Fait",
      "En cours",
      "Bloquants",
    ]);
    expect(result.title).toBe("standup");
  });
});
