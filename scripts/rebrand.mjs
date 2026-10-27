#!/usr/bin/env node
// Rebranding Syntheo : remplace les identifiants Anarlog/anlg/hyprnote dans les
// fichiers texte suivis. Les hôtes Fastrepl sont protégés (traitement manuel).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Sentinelles : mises en place avant les règles génériques, restaurées après.
const KEEP = {
  "anarlog.so": "\uE000KEEP_SO\uE000",
  "anarlog.git": "\uE000KEEP_GIT\uE000",
};

// Règles ordonnées, sensibles à la casse.
export const RULES = [
  [/anarlog\.so/g, KEEP["anarlog.so"]],
  [/anarlog\.git/g, KEEP["anarlog.git"]],
  // `anarlog.dev` nu (URL/fin de mot) protégé ; `anarlog.dev.x` reste renommable.
  [/anarlog\.dev(?![A-Za-z0-9.-])/g, "\uE000KEEP_DEV\uE000"],
  [/Anarlog/g, "Syntheo"],
  [/ANARLOG/g, "SYNTHEO"],
  [/anarlog/g, "syntheo"],
  [/Anlg/g, "Syntheo"],
  [/ANLG/g, "SYNTHEO"],
  [/anlg/g, "syntheo"],
  [/Hyprnote/g, "Syntheo"],
  [/HYPRNOTE/g, "SYNTHEO"],
  [/hyprnote/g, "syntheo"],
  [/\uE000KEEP_SO\uE000/g, "anarlog.so"],
  [/\uE000KEEP_GIT\uE000/g, "anarlog.git"],
  [/\uE000KEEP_DEV\uE000/g, "anarlog.dev"],
];

export function rebrandText(input) {
  let out = input;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".codegraph",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);
const SKIP_BASENAMES = new Set([
  "Cargo.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "LICENSE",
  "NOTICE.md",
]);
// Le codemod se contient lui-même : ne jamais le réécrire.
const SKIP_FILES = new Set(["scripts/rebrand.mjs", "scripts/rebrand.test.mjs"]);
const SKIP_PREFIXES = [
  "apps/desktop/src/i18n/locales",
  "docs/superpowers",
  ".superpowers",
];
const EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".json5",
  ".rs",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".sh",
  ".bash",
  ".py",
  ".swift",
  ".sql",
  ".snap",
  ".txt",
  ".jinja",
  ".ftl",
  ".cfg",
  ".ini",
  ".conf",
  ".plist",
  ".entitlements",
  ".nix",
  ".service",
  ".gradle",
  ".properties",
]);
const EXT_LESS = new Set(["PKGBUILD", "Dockerfile", "Makefile"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const rel = relative(ROOT, abs).replaceAll("\\", "/");
    if (
      SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`)) ||
      SKIP_FILES.has(rel)
    ) {
      continue;
    }
    if (statSync(abs).isDirectory()) {
      yield* walk(abs);
    } else if (
      !SKIP_BASENAMES.has(entry) &&
      (EXT.has(extname(entry)) || EXT_LESS.has(entry))
    ) {
      yield abs;
    }
  }
}

function main() {
  const write = process.argv.includes("--write");
  const onlyIdx = process.argv.indexOf("--path");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  let changedFiles = 0;
  for (const abs of walk(only ? join(ROOT, only) : ROOT)) {
    const before = readFileSync(abs, "utf8");
    const after = rebrandText(before);
    if (after !== before) {
      changedFiles += 1;
      if (write) writeFileSync(abs, after);
      else console.log(relative(ROOT, abs));
    }
  }
  console.log(
    `${write ? "réécrits" : "à réécrire"} : ${changedFiles} fichiers`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
