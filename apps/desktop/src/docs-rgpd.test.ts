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
  // Télémétrie : retirée du code, plus seulement neutralisée.
  expect(rgpd).toContain("Aucune télémétrie");
  expect(rgpd).not.toContain("neutralisés");
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

it("docs_rgpd_states_no_audio_is_ever_written", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  expect(rgpd).not.toContain("reste dans le dossier temporaire");
  expect(rgpd).not.toContain("import dont la transcription échoue");
  expect(rgpd).not.toContain("copie normalisée");
  expect(rgpd).toMatch(/ne touche plus jamais le disque/i);
  expect(rgpd).toContain("même temporairement");
});

it("rgpd_lists_stt_as_on_prem_only", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Adaptateurs STT cloud retirés (04b-1) et providers LLM cloud retirés
  // (04b-3) : il ne reste que les endpoints configurés.
  expect(rgpd).not.toContain("Deepgram");
  expect(rgpd).toContain("NVIDIA NIM");
});

it("rgpd_lists_no_model_download", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Inférence embarquée retirée (04b-2) : plus aucun modèle téléchargé.
  expect(rgpd).not.toContain("models.anarlog.so");
  expect(rgpd).toContain("models/stt");
  expect(rgpd).toContain("models/llm");
  expect(rgpd).not.toMatch(/diarisation locale/i);
});

it("rgpd_documents_legacy_voiceprint_purge", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Empreintes vocales d'une version antérieure : effacées au démarrage.
  expect(rgpd).toMatch(/empreintes vocales[^.]*effacées au démarrage/i);
});

it("rgpd_lists_only_the_configured_llm_endpoint", () => {
  const rgpd = readFileSync(join(ROOT, "docs/conformite/rgpd.md"), "utf8");
  // Providers LLM cloud retirés (04b-3) : seul l'endpoint configuré reçoit
  // les prompts, sans en-tête d'empreinte d'appareil.
  expect(rgpd).not.toMatch(/openrouter|anthropic/i);
  expect(rgpd).toContain("endpoint LLM configuré");
  expect(rgpd).toMatch(/empreinte d'appareil/);
});
