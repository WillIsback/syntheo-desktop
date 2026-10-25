import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou : le dépôt ne contient plus que le client desktop et la CLI. Les
// applications serveur, web, mobile, Stripe et watchOS héritées d'Anarlog sont
// supprimées, ainsi que leurs packages exclusifs.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const REPO_ROOT = join(process.cwd(), "../..");

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

describe("monorepo scope", () => {
  it.each([
    "apps/web",
    "apps/mobile",
    "apps/stripe",
    "apps/watch",
    "packages/supabase",
    "packages/pricing",
    "packages/mobile-bridge-rn",
    "supabase",
    "process-compose.backend.yaml",
  ])("removes %s", (path) => {
    expect(existsSync(join(REPO_ROOT, path))).toBe(false);
  });

  it("root_config_no_longer_references_removed_apps", () => {
    const files = [
      "package.json",
      "turbo.json",
      "process-compose.yaml",
      "Taskfile.yaml",
      "dprint.json",
      "eslint.config.js",
      "scripts/dev.mjs",
      "scripts/release-version.mjs",
      ".oxfmtrc.json",
      ".oxlintrc.json",
      ".vscode/settings.json",
      ".codex/environments/environment.toml",
    ];
    const offenders = files.filter((file) =>
      /apps\/(web|mobile|api|stripe|watch)\b|@anlg\/web\b|supabase/.test(
        read(file),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("no_workflow_references_removed_apps", () => {
    const dir = ".github/workflows";
    const offenders = readdirSync(join(REPO_ROOT, dir)).filter((name) =>
      /apps\/(web|mobile|api|stripe|watch)\b/.test(read(join(dir, name))),
    );
    expect(offenders).toEqual([]);
  });
});
