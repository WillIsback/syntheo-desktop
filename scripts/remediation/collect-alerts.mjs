#!/usr/bin/env node
/**
 * Collecte les alertes GitHub ouvertes (Code Scanning + Dependabot) et les
 * regroupe en tâches sans conflit de fichiers.
 *
 * Sortie :
 *   $REMEDIATION_DIR/tasks.json    liste des tâches prêtes pour l'orchestrateur
 *   $REMEDIATION_DIR/summary.json  compteurs par catégorie
 *
 * Usage :
 *   node scripts/remediation/collect-alerts.mjs [--repo owner/name]
 *
 * Aucun push, aucune modification du dépôt : seuls des fichiers temporaires
 * sont écrits.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REMEDIATION_DIR =
  process.env.REMEDIATION_DIR ||
  join(tmpdir(), "opencode", "syntheo-remediation");
const REPO = process.env.GITHUB_REPOSITORY || "WillIsback/syntheo-desktop";

/** Lit un chemin de l'API GitHub avec pagination et renvoie un tableau plat. */
function ghApi(path) {
  const out = execFileSync("gh", ["api", "--paginate", "--slurp", path], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out).flat();
}

/** Transforme une alerte Code Scanning en objet compact. */
function compactCodeScanning(alert) {
  const location = alert.most_recent_instance?.location ?? {};
  return {
    number: alert.number,
    rule: alert.rule?.id,
    severity: alert.rule?.severity,
    tool: alert.tool?.name,
    file: location.path,
    line: location.start_line,
    message: alert.most_recent_instance?.message?.text,
    url: alert.html_url,
  };
}

/** Transforme une alerte Dependabot en objet compact. */
function compactDependabot(alert) {
  const advisory = alert.security_advisory ?? {};
  return {
    number: alert.number,
    severity: advisory.severity,
    pkg: alert.dependency?.package?.name,
    manifest: alert.dependency?.manifest_path,
    summary: advisory.summary,
    url: alert.html_url,
  };
}

/** Slug de branche stable et lisible. Git interdit un nom finissant par `.lock`. */
function slug(value) {
  return value
    .replace(/^\.?\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/\.lock$/i, "-lock")
    .toLowerCase();
}

function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf("--repo");
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : REPO;

  console.log(`Collecte des alertes pour ${repo}...`);

  const rawCodeScanning = ghApi(
    `repos/${repo}/code-scanning/alerts?state=open&per_page=100`,
  );
  const rawDependabot = ghApi(
    `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
  );

  const codeScanning = rawCodeScanning.map(compactCodeScanning);
  const dependabot = rawDependabot.map(compactDependabot);

  const tasks = [];

  // --- Alertes de type secret (Gitleaks) : une seule tâche de triage ---
  const secretAlerts = codeScanning.filter(
    (alert) => alert.tool === "Gitleaks",
  );
  const otherAlerts = codeScanning.filter((alert) => alert.tool !== "Gitleaks");

  if (secretAlerts.length > 0) {
    tasks.push({
      id: "secrets-triage",
      kind: "secret-triage",
      title: "Triage des alertes Gitleaks (faux positifs vs rotation)",
      branch: "fix/secrets-triage",
      files: [...new Set(secretAlerts.map((alert) => alert.file))].sort(),
      alerts: secretAlerts,
    });
  }

  // --- Alertes CodeQL : regroupées par fichier ---
  const byFile = new Map();
  for (const alert of otherAlerts) {
    if (!alert.file) continue;
    if (!byFile.has(alert.file)) byFile.set(alert.file, []);
    byFile.get(alert.file).push(alert);
  }

  for (const [file, alerts] of byFile) {
    const id = `cs-${slug(file)}`;
    tasks.push({
      id,
      kind: "code-scanning",
      title: alerts.map((alert) => alert.rule).join(", "),
      branch: `fix/${id}`,
      files: [file],
      alerts,
    });
  }

  // --- Dependabot : regroupées par manifeste, écosystèmes combinés ---
  const byManifest = new Map();
  for (const alert of dependabot) {
    if (!alert.manifest) continue;
    if (!byManifest.has(alert.manifest)) byManifest.set(alert.manifest, []);
    byManifest.get(alert.manifest).push(alert);
  }

  // pnpm-lock.yaml et package.json partagent le même lockfile : une seule tâche.
  const pnpmAlerts = [
    ...(byManifest.get("pnpm-lock.yaml") ?? []),
    ...(byManifest.get("package.json") ?? []),
  ];
  if (pnpmAlerts.length > 0) {
    tasks.push({
      id: "deps-pnpm",
      kind: "dependabot",
      title: "Mise à jour des dépendances JavaScript (pnpm)",
      branch: "fix/deps-pnpm",
      files: ["package.json", "pnpm-lock.yaml"],
      alerts: pnpmAlerts,
    });
  }

  for (const [manifest, alerts] of byManifest) {
    if (manifest === "pnpm-lock.yaml" || manifest === "package.json") continue;
    const id = `deps-${slug(manifest)}`;
    tasks.push({
      id,
      kind: "dependabot",
      title: `Mise à jour des dépendances (${manifest})`,
      branch: `fix/${id}`,
      files: [manifest],
      alerts,
    });
  }

  // Les tâches Dependabot sont sérialisées par l'orchestrateur : on les place en tête.
  const ordered = [
    ...tasks.filter((task) => task.kind === "dependabot"),
    ...tasks.filter((task) => task.kind === "secret-triage"),
    ...tasks.filter((task) => task.kind === "code-scanning"),
  ];

  mkdirSync(REMEDIATION_DIR, { recursive: true });
  writeFileSync(
    join(REMEDIATION_DIR, "tasks.json"),
    `${JSON.stringify(ordered, null, 2)}\n`,
  );

  const summary = {
    repo,
    collected_at: new Date().toISOString(),
    code_scanning_open: codeScanning.length,
    dependabot_open: dependabot.length,
    tasks: ordered.length,
    by_kind: ordered.reduce((acc, task) => {
      acc[task.kind] = (acc[task.kind] ?? 0) + 1;
      return acc;
    }, {}),
  };
  writeFileSync(
    join(REMEDIATION_DIR, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Code Scanning ouverts : ${codeScanning.length}`);
  console.log(`Dependabot ouverts    : ${dependabot.length}`);
  console.log(
    `Tâches générées       : ${ordered.length} → ${join(REMEDIATION_DIR, "tasks.json")}`,
  );
}

main();
