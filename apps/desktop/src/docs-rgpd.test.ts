import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Vitest s'exécute depuis apps/desktop : la racine du dépôt est deux niveaux
// au-dessus.
const ROOT = join(process.cwd(), "..", "..");

it("docs_rgpd_is_referenced", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  for (const section of [
    "## Données stockées",
    "## Flux réseau",
    "## Garanties techniques",
    "## Responsabilités de l'utilisateur",
  ]) {
    expect(rgpd).toContain(section);
  }
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  expect(readme).toContain("docs/conformite/rgpd.md");
});

it("docs_rgpd_lists_every_known_flow_and_store", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Flux réseau hors inférence encore présents dans le code.
  for (const flow of ["api.github.com", "api.iconify.design"]) {
    expect(rgpd).toContain(flow);
  }
  // Stockages locaux annexes.
  for (const store of ["app.log", "tantivy", "export"]) {
    expect(rgpd).toContain(store);
  }
  // Télémétrie : neutralisée, pas encore retirée du code.
  expect(rgpd).toContain("neutralisé");
  expect(rgpd).not.toContain("analytics et Sentry retirés");
  expect(rgpd).not.toContain("**Aucun autre flux**");
});

it("docs_rgpd_reflects_capture_without_audio", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  expect(rgpd).not.toContain("le conserve par défaut (`forever`)");
  expect(rgpd).not.toContain(
    "l'enregistrement audio est encore écrit sur\n>   disque pendant la capture",
  );
  expect(rgpd).toContain("dictée");
  expect(rgpd).toContain("import");
});

it("docs_rgpd_states_failed_import_copy_is_kept", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  expect(rgpd).toContain("import dont la transcription échoue");
});

it("rgpd_lists_stt_as_on_prem_only", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Les adaptateurs STT cloud sont retirés (04b-1) ; restent les providers
  // LLM cloud jusqu'au 04b-3.
  expect(rgpd).not.toContain("Deepgram");
  expect(rgpd).toContain("04b-3");
});

it("rgpd_lists_no_model_download", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Inférence embarquée retirée (04b-2) : plus aucun modèle téléchargé.
  expect(rgpd).not.toContain("models.anarlog.so");
  expect(rgpd).toContain("models/stt");
  expect(rgpd).toContain("models/llm");
  expect(rgpd).not.toMatch(/diarisation locale/i);
});
