import { describe, expect, it } from "vitest";

import { detectMeetingImportProviders } from "./providers";

describe("meeting import providers", () => {
  it("détecte la CLI locale Plaud par bundle id et par nom", () => {
    expect(
      detectMeetingImportProviders([
        { id: "ai.plaud.desktop.plaud", name: "Plaud Desktop" },
      ]).map((provider) => provider.id),
    ).toEqual(["plaud"]);

    expect(
      detectMeetingImportProviders([
        { id: "windows:hklm:Plaud Desktop", name: "Plaud Desktop" },
      ]).map((provider) => provider.id),
    ).toEqual(["plaud"]);
  });

  it("détecte les apps dont on importe l'export de fichier", () => {
    expect(
      detectMeetingImportProviders([
        { id: "com.jamie.app", name: "Jamie" },
      ]).map((provider) => provider.id),
    ).toEqual(["jamie"]);
  });

  it("n'accepte que les identifiants exacts (pas les préfixes)", () => {
    expect(
      detectMeetingImportProviders([
        { id: "ai.plaud.desktop.plaud.helper", name: "Something Else" },
      ]).map((provider) => provider.id),
    ).toEqual([]);
  });

  it("ne détecte rien pour une app inconnue", () => {
    expect(
      detectMeetingImportProviders([
        { id: "com.google.Chrome", name: "Google Chrome" },
      ]).map((provider) => provider.id),
    ).toEqual([]);
  });
});
