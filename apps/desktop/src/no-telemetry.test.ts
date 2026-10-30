import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou : le produit promet « aucune télémétrie ». Aucune dépendance ni
// aucun import d'un SDK d'analytics ou de remontée d'erreurs ne doit revenir.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const REPO_ROOT = join(process.cwd(), "../..");
const SRC = join(process.cwd(), "src");

// Paquets npm interdits : préfixe de scope (se terminant par "/") ou nom de
// paquet, variantes `nom-*` et sous-chemins `nom/*` compris (mixpanel-browser).
const FORBIDDEN_NPM = [
  "posthog-js",
  "posthog-node",
  "@sentry/",
  "@vercel/analytics",
  "mixpanel",
  "@amplitude/",
  "@segment/",
];

// Crates interdites (sentry couvre aussi sentry-*).
const FORBIDDEN_CRATES =
  /^(sentry(-[\w-]+)?|posthog-rs|tauri-plugin-sentry|tauri-plugin-aptabase)$/;

const isForbiddenNpm = (name: string) =>
  FORBIDDEN_NPM.some((forbidden) =>
    forbidden.endsWith("/")
      ? name.startsWith(forbidden)
      : name === forbidden ||
        name.startsWith(`${forbidden}/`) ||
        name.startsWith(`${forbidden}-`),
  );

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function packageJsonFiles(): string[] {
  const packages = readdirSync(join(REPO_ROOT, "packages"))
    .map((name) => join("packages", name, "package.json"))
    .filter((path) => existsSync(join(REPO_ROOT, path)));
  return ["package.json", "apps/desktop/package.json", ...packages];
}

function cargoManifests(): string[] {
  const members = ["crates", "plugins"].flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir)).map((name) =>
      join(dir, name, "Cargo.toml"),
    ),
  );
  return [
    "Cargo.toml",
    "apps/cli/Cargo.toml",
    "apps/desktop/src-tauri/Cargo.toml",
    ...members,
  ].filter((path) => existsSync(join(REPO_ROOT, path)));
}

// Noms de crates déclarés dans un manifeste : clés `nom = …`/`nom.workspace`,
// tables `[dependencies.nom]` et renommages `package = "nom"`.
function cargoDependencyNames(manifest: string): string[] {
  const keys = [...manifest.matchAll(/^\s*([\w-]+)\s*(?:=|\.)/gm)].map(
    (m) => m[1],
  );
  const tables = [
    ...manifest.matchAll(/^\s*\[(?:[\w.-]+\.)?dependencies\.([\w-]+)\]/gm),
  ].map((m) => m[1]);
  const renamed = [...manifest.matchAll(/package\s*=\s*"([\w-]+)"/g)].map(
    (m) => m[1],
  );
  return [...keys, ...tables, ...renamed];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "i18n" ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.gen\./.test(name) ? [path] : [];
  });
}

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

describe("no telemetry", () => {
  it("declares no telemetry npm dependency", () => {
    const offenders = packageJsonFiles().flatMap((file) => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, file), "utf8"),
      ) as Partial<Record<(typeof DEP_FIELDS)[number], Record<string, string>>>;
      return DEP_FIELDS.flatMap((field) =>
        Object.keys(manifest[field] ?? {})
          .filter(isForbiddenNpm)
          .map((name) => `${file}: ${name}`),
      );
    });
    expect(offenders).toEqual([]);
  });

  it("declares no telemetry crate", () => {
    const offenders = cargoManifests().flatMap((file) =>
      cargoDependencyNames(readFileSync(join(REPO_ROOT, file), "utf8"))
        .filter((name) => FORBIDDEN_CRATES.test(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("imports no telemetry package from the desktop sources", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => relative(SRC, path) !== "no-telemetry.test.ts")
      .flatMap((path) =>
        [...readFileSync(path, "utf8").matchAll(IMPORT_SPECIFIER)]
          .map((m) => m[1])
          .filter(isForbiddenNpm)
          .map((name) => `${relative(SRC, path)}: ${name}`),
      );
    expect(offenders).toEqual([]);
  });

  it("detects the forbidden patterns it guards against", () => {
    expect(isForbiddenNpm("@sentry/react")).toBe(true);
    expect(isForbiddenNpm("posthog-js/react")).toBe(true);
    expect(isForbiddenNpm("mixpanel-browser")).toBe(true);
    expect(isForbiddenNpm("@tauri-apps/plugin-os")).toBe(false);
    expect(
      cargoDependencyNames(
        'sentry = "0.34"\n[dependencies.tauri-plugin-aptabase]\nfoo = { package = "posthog-rs" }',
      ).filter((name) => FORBIDDEN_CRATES.test(name)),
    ).toEqual(["sentry", "tauri-plugin-aptabase", "posthog-rs"]);
  });
});
