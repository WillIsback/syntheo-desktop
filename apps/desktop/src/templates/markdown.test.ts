import { describe, expect, it } from "vitest";

import { parseTemplateMarkdown, templateSectionsToMarkdown } from "./markdown";

describe("parseTemplateMarkdown", () => {
  it("découpe les sections sur les titres #", () => {
    expect(
      parseTemplateMarkdown(
        "# Participants\nListe les participants.\n\n## Décisions\nRésume les décisions.",
      ),
    ).toEqual([
      { title: "Participants", description: "Liste les participants." },
      { title: "Décisions", description: "Résume les décisions." },
    ]);
  });

  it("fusionne les lignes de consigne", () => {
    expect(parseTemplateMarkdown("# A\nligne 1\nligne 2")).toEqual([
      { title: "A", description: "ligne 1\nligne 2" },
    ]);
  });

  it("ignore le texte avant le premier titre", () => {
    expect(parseTemplateMarkdown("préambule\n# A\nx")).toEqual([
      { title: "A", description: "x" },
    ]);
  });

  it("accepte une section sans consigne", () => {
    expect(parseTemplateMarkdown("# A")).toEqual([
      { title: "A", description: "" },
    ]);
  });
});

describe("templateSectionsToMarkdown", () => {
  it("est l'inverse du parseur", () => {
    const sections = [
      { title: "Participants", description: "Liste." },
      { title: "Décisions", description: "Résume.\nSur deux lignes." },
    ];
    expect(parseTemplateMarkdown(templateSectionsToMarkdown(sections))).toEqual(
      sections,
    );
  });
});
