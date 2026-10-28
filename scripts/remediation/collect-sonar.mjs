#!/usr/bin/env node
/**
 * Collecte les issues SonarCloud ouvertes et les regroupe par fichier.
 *
 * Sortie :
 *   $REMEDIATION_DIR/sonar-tasks.json
 *   $REMEDIATION_DIR/sonar-summary.json
 *
 * Usage :
 *   node scripts/remediation/collect-sonar.mjs [--project <key>] [--limit N]
 *
 * Le projet public ne nécessite pas de jeton.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REMEDIATION_DIR =
  process.env.REMEDIATION_DIR ||
  join(tmpdir(), "opencode", "syntheo-remediation");
const PROJECT = "WillIsback_syntheo-desktop";
const API = "https://sonarcloud.io/api/issues/search";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const project = option("--project", PROJECT);
const limit = Number(option("--limit", "0")) || Infinity;

const SEVERITY_RANK = { BLOCKER: 5, CRITICAL: 4, MAJOR: 3, MINOR: 2, INFO: 1 };

function slug(value) {
  return value
    .replace(/^[^:]+:/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    componentKeys: project,
    issueStatuses: "OPEN,CONFIRMED",
    ps: "500",
    p: String(page),
    additionalFields: "_all",
  });
  const response = await fetch(`${API}?${params}`);
  if (!response.ok) {
    throw new Error(`SonarCloud HTTP ${response.status} : ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  console.log(`Collecte SonarCloud pour ${project}...`);
  const first = await fetchPage(1);
  const total = first.total;
  const pages = Math.ceil(total / first.ps);
  const issues = [...first.issues];

  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPage(page);
    issues.push(...next.issues);
    process.stdout.write(`\r${issues.length}/${total}`);
  }
  process.stdout.write("\n");

  const byFile = new Map();
  for (const issue of issues) {
    const file = (issue.component ?? "").replace(`${project}:`, "");
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({
      key: issue.key,
      rule: issue.rule,
      severity: issue.severity,
      type: issue.type,
      line: issue.line,
      message: issue.message,
      effort: issue.effort,
      url: `https://sonarcloud.io/project/issues?id=${project}&open=${issue.key}`,
    });
  }

  const tasks = [...byFile.entries()]
    .map(([file, alerts]) => ({
      id: `sonar-${slug(file)}`,
      kind: "sonar",
      title: alerts.map((alert) => alert.rule).join(", "),
      branch: `fix/sonar-${slug(file)}`,
      files: [file],
      alerts: alerts.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)),
    }))
    .sort(
      (a, b) =>
        Math.max(...b.alerts.map((alert) => SEVERITY_RANK[alert.severity] ?? 0)) -
        Math.max(...a.alerts.map((alert) => SEVERITY_RANK[alert.severity] ?? 0)),
    )
    .slice(0, limit);

  mkdirSync(REMEDIATION_DIR, { recursive: true });
  writeFileSync(join(REMEDIATION_DIR, "sonar-tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`);

  const bySeverity = issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] ?? 0) + 1;
    return acc;
  }, {});
  const summary = {
    project,
    collected_at: new Date().toISOString(),
    total_issues: total,
    files: byFile.size,
    tasks: tasks.length,
    by_severity: bySeverity,
  };
  writeFileSync(join(REMEDIATION_DIR, "sonar-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Issues ouvertes : ${total}`);
  console.log(`Fichiers        : ${byFile.size}`);
  console.log(`Tâches générées : ${tasks.length} → ${join(REMEDIATION_DIR, "sonar-tasks.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
