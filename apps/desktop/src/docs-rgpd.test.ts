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
