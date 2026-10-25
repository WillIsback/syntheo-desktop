import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    "bacon.toml",
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

  it("keeps_only_desktop_and_cli_apps", () => {
    const apps = readdirSync(join(REPO_ROOT, "apps")).filter((name) =>
      statSync(join(REPO_ROOT, "apps", name)).isDirectory(),
    );
    expect(apps.sort()).toEqual(["cli", "desktop"]);
  });

  it("cargo_workspace_has_no_server_member", () => {
    const manifest = read("Cargo.toml");
    // crates/api-client reste : c'est le client HTTP du desktop.
    expect(manifest).not.toMatch(
      /"apps\/api"|crates\/api-(?!client\b)|crates\/(transcribe-proxy|llm-proxy|supabase-|mobile-bridge)/,
    );
  });

  it.each([
    "api-auth",
    "api-calendar",
    "api-cloud",
    "api-crm",
    "api-env",
    "api-error",
    "api-mail",
    "api-meeting-import",
    "api-messenger",
    "api-nango",
    "api-notion",
    "api-pyannote",
    "api-research",
    "api-subscription",
    "api-sync",
    "api-ticket",
    "api-zoom",
    "exa",
    "google-mail",
    "jina",
    "linear",
    "llm-proxy",
    "loops",
    "mcp",
    "meeting-capture",
    "mobile-bridge",
    "nango",
    "pyannote-cloud",
    "slack-web",
    "supabase-auth",
    "supabase-storage",
    "transcribe-proxy",
    "uniffi-bindgen",
    "updater-core",
  ])("removes crate %s", (name) => {
    expect(existsSync(join(REPO_ROOT, "crates", name))).toBe(false);
  });

  it("keeps_optional_and_tooling_crates", () => {
    for (const name of ["audio-mock", "tcc", "chrome-native-host", "xtask"]) {
      expect(existsSync(join(REPO_ROOT, "crates", name))).toBe(true);
    }
  });
});
