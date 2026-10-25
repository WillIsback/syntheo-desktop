import { expect, it, vi } from "vitest";

vi.mock("@anlg/plugin-detect", () => ({ commands: {} }));
vi.mock("@anlg/ui/components/ui/toast", () => ({ toast: {} }));
vi.mock("./meeting-consent-store", () => ({
  persistDisclosureAttempt: vi.fn(),
}));

import { MEETING_DISCLOSURE_MESSAGE } from "./meeting-disclosure";

it("meeting_disclosure_makes_no_unverified_guarantee", () => {
  // Le message part aux participants (art. 13 RGPD) : il ne promet ni absence
  // d'audio conservé ni traitement local tant que les chantiers 04b et 04c ne
  // les garantissent pas.
  expect(MEETING_DISCLOSURE_MESSAGE).toBe(
    "J'utilise Syntheo pour transcrire cette réunion ; le transcript est conservé sur mon poste.",
  );
  expect(MEETING_DISCLOSURE_MESSAGE).not.toMatch(
    /aucun enregistrement|local\)/,
  );
});
