#!/usr/bin/env node
/**
 * Collecte les issues Aikido ouvertes du dépôt et les regroupe par fichier.
 *
 * Sortie :
 *   $REMEDIATION_DIR/aikido-tasks.json
 *   $REMEDIATION_DIR/aikido-summary.json
 *
 * Usage :
 *   node scripts/remediation/collect-aikido.mjs [--repo <nom>] [--types sast,iac] [--limit N] [--offset N]
 *
 * Authentification : client API Aikido (Settings › Integrations › API, portée
 * `issues:read`), fourni par AIKIDO_CLIENT_ID et AIKIDO_CLIENT_SECRET.
 * Région : AIKIDO_API_BASE (par défaut l'instance UE,
 * https://app.aikido.dev ; US : https://app.us.aikido.dev).
 *
 * Les dépendances (`open_source`) et les secrets (`leaked_secret`) restent
 * traités par les tâches Dependabot et Gitleaks de collect-alerts.mjs : par
 * défaut, seules les issues de code (`sast`, `iac`) sont collectées.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REMEDIATION_DIR =
  process.env.REMEDIATION_DIR ||
  join(tmpdir(), "opencode", "syntheo-remediation");
const API_ORIGIN = (process.env.AIKIDO_API_BASE || "https://app.aikido.dev")
  .trim()
  .replace(/\/+$/, "");
const REPO = "syntheo-desktop";
const PER_PAGE = 1000;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const repo = option("--repo", REPO);
const types = option("--types", "sast,iac")
  .split(",")
  .map((type) => type.trim())
  .filter(Boolean);
const limit = Number(option("--limit", "0")) || Infinity;
const offset = Number(option("--offset", "0")) || 0;

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function slug(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} manquant : créez un client API Aikido (portée issues:read).`,
    );
  }
  return value;
}

// Seules les instances officielles d'Aikido sont acceptées : le jeton client
// ne doit jamais partir vers une autre origine.
function assertAikidoOrigin(origin) {
  const { protocol, hostname } = new URL(origin);
  if (
    protocol !== "https:" ||
    !/^app(\.[a-z]{2})?\.aikido\.dev$/.test(hostname)
  ) {
    throw new Error(`AIKIDO_API_BASE invalide : ${origin}`);
  }
}

async function fetchToken() {
  const credentials = Buffer.from(
    `${requireEnv("AIKIDO_CLIENT_ID")}:${requireEnv("AIKIDO_CLIENT_SECRET")}`,
  ).toString("base64");
  const response = await fetch(`${API_ORIGIN}/api/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    throw new Error(
      `Aikido OAuth HTTP ${response.status} : ${await response.text()}`,
    );
  }
  const { access_token: token } = await response.json();
  if (!token) throw new Error("Aikido OAuth : pas de access_token.");
  return token;
}

async function fetchPage(token, type, page) {
  const params = new URLSearchParams({
    format: "json",
    filter_status: "open",
    filter_code_repo_name: repo,
    filter_issue_type: type,
    page: String(page),
    per_page: String(PER_PAGE),
  });
  const response = await fetch(
    `${API_ORIGIN}/api/public/v1/issues/export?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Aikido HTTP ${response.status} : ${await response.text()}`,
    );
  }
  return response.json();
}

async function fetchIssues(token, type) {
  const issues = [];
  for (let page = 0; ; page += 1) {
    const batch = await fetchPage(token, type, page);
    issues.push(...batch);
    process.stdout.write(`\r${type} : ${issues.length}`);
    if (batch.length < PER_PAGE) break;
  }
  process.stdout.write("\n");
  return issues;
}

function toAlert(issue) {
  return {
    id: issue.id,
    type: issue.type,
    rule: issue.rule ?? issue.rule_id ?? issue.type,
    severity: String(issue.severity ?? "").toLowerCase(),
    line: issue.start_line ?? null,
    title: issue.title ?? issue.rule ?? "",
    description: issue.description ?? "",
    remediation: issue.how_to_fix ?? issue.remediation ?? "",
  };
}

async function main() {
  assertAikidoOrigin(API_ORIGIN);
  console.log(`Collecte Aikido pour ${repo} (${types.join(", ")})...`);
  const token = await fetchToken();
  const issues = [];
  for (const type of types) {
    issues.push(...(await fetchIssues(token, type)));
  }

  const byFile = new Map();
  for (const issue of issues) {
    const file = issue.affected_file ?? issue.file;
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(toAlert(issue));
  }

  const maxRank = (alerts) =>
    Math.max(...alerts.map((alert) => SEVERITY_RANK[alert.severity] ?? 0));
  const tasks = [...byFile.entries()]
    .map(([file, alerts]) => ({
      id: `aikido-${slug(file)}`,
      kind: "aikido",
      title: [...new Set(alerts.map((alert) => alert.rule))].join(", "),
      branch: `fix/aikido-${slug(file)}`,
      files: [file],
      alerts: alerts.sort(
        (a, b) =>
          (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
      ),
    }))
    .sort((a, b) => maxRank(b.alerts) - maxRank(a.alerts))
    .slice(offset, offset + limit);

  mkdirSync(REMEDIATION_DIR, { recursive: true });
  writeFileSync(
    join(REMEDIATION_DIR, "aikido-tasks.json"),
    `${JSON.stringify(tasks, null, 2)}\n`,
  );

  const bySeverity = issues.reduce((acc, issue) => {
    const severity = String(issue.severity ?? "inconnue").toLowerCase();
    acc[severity] = (acc[severity] ?? 0) + 1;
    return acc;
  }, {});
  const summary = {
    repo,
    types,
    collected_at: new Date().toISOString(),
    total_issues: issues.length,
    files: byFile.size,
    tasks: tasks.length,
    by_severity: bySeverity,
  };
  writeFileSync(
    join(REMEDIATION_DIR, "aikido-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Issues ouvertes : ${issues.length}`);
  console.log(`Fichiers        : ${byFile.size}`);
  console.log(
    `Tâches générées : ${tasks.length} → ${join(REMEDIATION_DIR, "aikido-tasks.json")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
