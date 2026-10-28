#!/usr/bin/env node
/**
 * Orchestrateur de remédiation.
 *
 * - Lit $REMEDIATION_DIR/tasks.json (généré par collect-alerts.mjs).
 * - Crée la branche d'intégration fix/master-remediation dans un worktree dédié.
 * - Pour chaque tâche : worktree isolé, agent `fixer`, validation locale, merge --no-ff.
 * - Les tâches Dependabot sont sérialisées ; les autres tournent avec une concurrence 2.
 * - Ne pousse jamais. La PR finale est laissée à l'utilisateur.
 *
 * Usage :
 *   node scripts/remediation/orchestrate.mjs [--dry-run] [--resume] [--only <kind>]
 *                                            [--task <id>] [--limit N]
 */

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const REMEDIATION_DIR =
  process.env.REMEDIATION_DIR ||
  join(tmpdir(), "opencode", "syntheo-remediation");
const LOG_DIR = join(REMEDIATION_DIR, "logs");
const INTEGRATION_BRANCH = "fix/master-remediation";
const INTEGRATION_WT = join(repoRoot, ".worktrees", "wt-integration");
const MODEL =
  process.env.REMEDIATION_MODEL ||
  "myprovider/nvidia/Qwen3.8-Flash-Next-FP4-Local";
const CONCURRENCY = Number(process.env.REMEDIATION_CONCURRENCY || 2);
const CARGO_TARGET_DIR =
  process.env.CARGO_TARGET_DIR || join(repoRoot, "target");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const DRY_RUN = flag("--dry-run");
const RESUME = flag("--resume");
const ONLY = option("--only", null);
const ONLY_TASK = option("--task", null);
const LIMIT = Number(option("--limit", "0")) || Infinity;

const STATE_FILE = join(REMEDIATION_DIR, "state.json");
const NEEDS_HUMAN_FILE = join(REMEDIATION_DIR, "needs-human.json");
const TASKS_FILE =
  process.env.REMEDIATION_TASKS || join(REMEDIATION_DIR, "tasks.json");

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

const state = loadJson(STATE_FILE, { completed: [], needs_human: [] });

/** Exécute une commande et renvoie son code de sortie. */
function run(command, commandArgs, cwd, { inherit = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR },
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function git(args, cwd = repoRoot) {
  return run("git", args, cwd);
}

function ensureIntegrationWorktree() {
  const list = git(["worktree", "list", "--porcelain"]);
  if (list.stdout.includes(`worktree ${INTEGRATION_WT}`)) return;

  const branch = git(["rev-parse", "--verify", INTEGRATION_BRANCH]);
  const branchExists = branch.ok;

  mkdirSync(dirname(INTEGRATION_WT), { recursive: true });

  if (branchExists) {
    const add = git(["worktree", "add", INTEGRATION_WT, INTEGRATION_BRANCH]);
    if (!add.ok) throw new Error(`worktree add échoué : ${add.stderr}`);
  } else {
    const add = git([
      "worktree",
      "add",
      INTEGRATION_WT,
      "-b",
      INTEGRATION_BRANCH,
      "main",
    ]);
    if (!add.ok) throw new Error(`création branche échouée : ${add.stderr}`);
  }
  console.log(`Worktree d'intégration prêt : ${INTEGRATION_WT}`);
}

/** Crée un clone isolé pour la tâche (un worktree ne suffit pas : OpenCode
 * résout le projet vers le dépôt principal et l'agent travaillerait sur main). */
function createTaskClone(task) {
  const clone = join(REMEDIATION_DIR, "clones", task.id);
  const branch = task.branch;

  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
  mkdirSync(dirname(clone), { recursive: true });

  const cloned = run(
    "git",
    ["clone", "--quiet", "--reference", repoRoot, "--branch", INTEGRATION_BRANCH, repoRoot, clone],
    repoRoot,
  );
  if (!cloned.ok) throw new Error(`clone échoué pour ${task.id} : ${cloned.stderr}`);

  const checkout = git(["checkout", "-b", branch], clone);
  if (!checkout.ok) throw new Error(`checkout échoué pour ${task.id} : ${checkout.stderr}`);

  if (task.kind !== "dependabot") linkNodeModules(clone);
  return clone;
}

function removeTaskClone(task) {
  const clone = join(REMEDIATION_DIR, "clones", task.id);
  if (existsSync(clone)) rmSync(clone, { recursive: true, force: true });
}

/** Dépendances Node partagées en lecture seule pour les tâches qui ne touchent pas aux lockfiles. */
function linkNodeModules(worktree) {
  const find = spawnSync(
    "find",
    [repoRoot, "-maxdepth", "4", "-name", "node_modules", "-type", "d", "-prune"],
    { encoding: "utf8" },
  );
  const dirs = find.stdout.split("\n").filter(Boolean);
  for (const source of dirs) {
    const target = join(worktree, relative(repoRoot, source));
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    spawnSync("ln", ["-s", source, target]);
  }

  // Les liens symboliques node_modules ne sont pas couverts par `node_modules/`
  // (le slash final ne matche que les dossiers). On les exclut localement.
  const gitDir = git(["rev-parse", "--git-dir"], worktree).stdout.trim();
  if (gitDir) {
    const absoluteGitDir = isAbsolute(gitDir) ? gitDir : join(worktree, gitDir);
    const exclude = join(absoluteGitDir, "info", "exclude");
    mkdirSync(dirname(exclude), { recursive: true });
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!current.includes("**/node_modules")) {
      appendFileSync(exclude, "\nnode_modules\n**/node_modules\n");
    }
  }
}

/** Déduit les commandes de validation à partir des fichiers touchés. */
function validationCommands(task) {
  if (task.kind === "secret-triage") return [];
  const files = task.files ?? [];
  const commands = [];
  const tsFiles = files.filter((file) => /\.(ts|tsx|mts|js|mjs|cjs)$/.test(file));
  const otherFiles = files.filter((file) => /\.(md|json|jsonc|ya?ml|toml)$/.test(file));
  const rustFiles = files.filter((file) => file.endsWith(".rs"));
  const pythonFiles = files.filter((file) => file.endsWith(".py"));

  if (files.includes("pnpm-lock.yaml") || files.includes("package.json")) {
    commands.push("pnpm install --frozen-lockfile");
  }
  if (files.includes("Cargo.lock") || files.some((file) => file.endsWith("Cargo.toml"))) {
    commands.push("cargo metadata --locked --format-version 1 > /dev/null");
  }
  if (tsFiles.length > 0) {
    commands.push(`./node_modules/.bin/oxfmt --check ${tsFiles.join(" ")}`);
    const desktopFiles = tsFiles.filter((file) => file.startsWith("apps/desktop/"));
    if (desktopFiles.length > 0) {
      commands.push(`./node_modules/.bin/oxlint --quiet ${desktopFiles.join(" ")}`);
      commands.push("./node_modules/.bin/tsc -p apps/desktop --noEmit");
    } else {
      commands.push(`./node_modules/.bin/eslint ${tsFiles.join(" ")}`);
    }
  }
  if (otherFiles.length > 0) {
    commands.push(`./node_modules/.bin/dprint check ${otherFiles.join(" ")}`);
  }
  if (rustFiles.length > 0) {
    const crateDir = nearestCargoDir(rustFiles[0]);
    if (crateDir) {
      commands.push(`cargo clippy --manifest-path ${crateDir}/Cargo.toml -- -D warnings`);
    }
  }
  if (pythonFiles.length > 0) {
    commands.push(`python3 -m py_compile ${pythonFiles.join(" ")}`);
  }
  return commands;
}

function nearestCargoDir(file) {
  let current = join(repoRoot, dirname(file));
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, "Cargo.toml"))) return relative(repoRoot, current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function renderPrompt(task) {
  const template = readFileSync(join(repoRoot, "scripts/remediation/prompt-worker.md"), "utf8");
  const firstAlert = task.alerts?.[0] ?? {};
  const replacements = {
    "{{TASK_ID}}": task.id,
    "{{KIND}}": task.kind,
    "{{TOOL}}": firstAlert.tool ?? task.kind,
    "{{RULE}}": firstAlert.rule ?? "(plusieurs)",
    "{{SEVERITY}}": firstAlert.severity ?? "(variable)",
    "{{FILES}}": (task.files ?? []).join(", "),
    "{{LINE}}": String(firstAlert.line ?? "—"),
    "{{MESSAGE}}": firstAlert.message ?? firstAlert.summary ?? "—",
    "{{URL}}": firstAlert.url ?? "—",
    "{{ALERTS_JSON}}": JSON.stringify(task.alerts ?? [], null, 2),
    "{{VALIDATION}}": validationCommands(task).join("\n"),
  };
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(token, value),
    template,
  );
}

/** Lance l'agent fixer dans le clone et écrit sa sortie dans un log. */
function runAgent(task, clone, prompt, suffix = "") {
  const logFile = join(LOG_DIR, `${task.id}${suffix}.log`);
  const title = `remediation ${task.id}`;
  const fullPrompt = `${prompt}${suffix ? `\n\n## Échec de validation précédent\n\n\`\`\`\n${suffix}\n\`\`\`\n` : ""}`;
  const timeoutMs = Number(process.env.REMEDIATION_AGENT_TIMEOUT_MS || 600000);

  return new Promise((resolve) => {
    const out = openAppend(logFile);
    const child = spawn(
      "opencode",
      [
        "run",
        "--standalone",
        "--model",
        MODEL,
        "--agent",
        "fixer",
        "--auto",
        "--format",
        "json",
        "--title",
        title,
        fullPrompt,
      ],
      { cwd: clone, stdio: ["ignore", out, out], env: { ...process.env, PWD: clone, INIT_CWD: clone } },
    );

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeFd(out);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: -1, logFile, timedOut: true });
    }, timeoutMs);

    child.on("close", (code) => finish({ ok: code === 0, code, logFile }));
    child.on("error", (error) =>
      finish({ ok: false, code: -1, logFile, error: String(error) }),
    );
  });
}

function openAppend(path) {
  mkdirSync(dirname(path), { recursive: true });
  return openSync(path, "a");
}

function closeFd(fd) {
  closeSync(fd);
}

function validate(task, worktree) {
  const commands = validationCommands(task);
  if (commands.length === 0) return { ok: true, output: "aucune commande" };
  const outputs = [];
  for (const command of commands) {
    const result = spawnSync("sh", ["-c", command], {
      cwd: worktree,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CARGO_TARGET_DIR, PWD: worktree, INIT_CWD: worktree },
    });
    outputs.push(`$ ${command}\n${result.stdout}${result.stderr}`);
    if (result.status !== 0) {
      return { ok: false, output: outputs.join("\n\n") };
    }
  }
  return { ok: true, output: outputs.join("\n\n") };
}

function mergeTask(task) {
  const clone = join(REMEDIATION_DIR, "clones", task.id);
  const fetched = git(["fetch", clone, `+${task.branch}:${task.branch}`], INTEGRATION_WT);
  if (!fetched.ok) {
    return { ok: false, output: fetched.stdout + fetched.stderr };
  }
  const merge = git(
    ["merge", "--no-ff", task.branch, "-m", `merge: ${task.id} (${task.kind})`],
    INTEGRATION_WT,
  );
  if (!merge.ok) {
    return { ok: false, output: merge.stdout + merge.stderr };
  }
  git(["branch", "-D", task.branch]);
  return { ok: true, output: merge.stdout };
}

function markCompleted(task) {
  if (!state.completed.includes(task.id)) state.completed.push(task.id);
  state.needs_human = state.needs_human.filter((entry) => entry.id !== task.id);
  writeFileSync(NEEDS_HUMAN_FILE, `${JSON.stringify(state.needs_human, null, 2)}\n`);
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function markNeedsHuman(task, reason, output) {
  state.needs_human = state.needs_human.filter((entry) => entry.id !== task.id);
  state.needs_human.push({
    id: task.id,
    kind: task.kind,
    branch: task.branch,
    files: task.files,
    reason,
    output: output.slice(-4000),
  });
  writeFileSync(NEEDS_HUMAN_FILE, `${JSON.stringify(state.needs_human, null, 2)}\n`);
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function processTask(task) {
  if (RESUME && state.completed.includes(task.id)) {
    console.log(`↷ ${task.id} déjà terminée, ignorée`);
    return { task, status: "skipped" };
  }

  console.log(`\n=== ${task.id} (${task.kind}) ===`);
  if (DRY_RUN) {
    console.log(`clone: ${join(REMEDIATION_DIR, "clones", task.id)}  branche: ${task.branch}`);
    console.log(`fichiers: ${(task.files ?? []).join(", ")}`);
    console.log(`validation: ${validationCommands(task).join(" ; ") || "(aucune)"}`);
    return { task, status: "dry-run" };
  }

  const prompt = renderPrompt(task);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let clone;
    try {
      clone = createTaskClone(task);

      const agent = await runAgent(task, clone, prompt, attempt === 2 ? ".retry" : "");
      if (!agent.ok) {
        const reason = `agent exit ${agent.code}`;
        if (attempt === 2) {
          markNeedsHuman(task, reason, agent.logFile);
          return { task, status: "needs-human", reason };
        }
        removeTaskClone(task);
        continue;
      }

      const validation = validate(task, clone);
      if (!validation.ok) {
        if (attempt === 2) {
          markNeedsHuman(task, "validation échouée", validation.output);
          return { task, status: "needs-human", reason: "validation" };
        }
        removeTaskClone(task);
        continue;
      }

      const commits = git(
        ["rev-list", "--count", `${INTEGRATION_BRANCH}..${task.branch}`],
        clone,
      );
      if (!commits.ok || Number(commits.stdout.trim()) === 0) {
        markNeedsHuman(
          task,
          "aucun commit produit (agent sans modification)",
          "Le worker n'a produit aucun commit. Vérifier l'alerte manuellement.",
        );
        removeTaskClone(task);
        return { task, status: "needs-human", reason: "aucun-commit" };
      }

      const merge = mergeTask(task);
      if (!merge.ok) {
        markNeedsHuman(task, "conflit de merge", merge.output);
        return { task, status: "needs-human", reason: "merge" };
      }

      markCompleted(task);
      removeTaskClone(task);
      return { task, status: "merged" };
    } catch (error) {
      if (attempt === 2) {
        markNeedsHuman(task, String(error), String(error));
        return { task, status: "needs-human", reason: "exception" };
      }
      if (clone) removeTaskClone(task);
    }
  }
  return { task, status: "needs-human" };
}

/** Pool async simple. */
async function pool(items, size, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });
  const tasks = loadJson(TASKS_FILE, []);
  if (tasks.length === 0) {
    console.error(`Aucune tâche : lancez d'abord collect-alerts.mjs`);
    process.exit(1);
  }

  let selected = tasks;
  if (ONLY) selected = selected.filter((task) => task.kind === ONLY);
  if (ONLY_TASK) selected = selected.filter((task) => task.id === ONLY_TASK);
  selected = selected.slice(0, LIMIT);

  if (selected.length === 0) {
    console.error("Aucune tâche ne correspond aux filtres.");
    process.exit(1);
  }

  if (!DRY_RUN) ensureIntegrationWorktree();

  // Dependabot d'abord, en série (lockfiles partagés).
  const dependencyTasks = selected.filter((task) => task.kind === "dependabot");
  const otherTasks = selected.filter((task) => task.kind !== "dependabot");

  const results = [];
  for (const task of dependencyTasks) {
    results.push(await processTask(task));
  }

  if (otherTasks.length > 0) {
    results.push(...(await pool(otherTasks, CONCURRENCY, processTask)));
  }

  const merged = results.filter((result) => result.status === "merged").length;
  const needsHuman = results.filter((result) => result.status === "needs-human").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  console.log(`\nRésumé : ${merged} mergées, ${needsHuman} à traiter, ${skipped} ignorées.`);
  if (needsHuman > 0) console.log(`Détails : ${NEEDS_HUMAN_FILE}`);
  if (!DRY_RUN) {
    console.log(
      `\nÉtape suivante (manuelle) :\n  git -C ${INTEGRATION_WT} log --oneline\n  git -C ${INTEGRATION_WT} push -u origin ${INTEGRATION_BRANCH}\n  gh pr create --base main --head ${INTEGRATION_BRANCH} ...`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
