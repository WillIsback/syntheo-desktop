import {
  commands as localApiCommands,
  type MarkdownExportFile,
  type MarkdownExportOptions,
} from "@syntheo/plugin-local-api";

import { hasMarkdownExportContent } from "./markdown-export";
import {
  type AutomationRunRecord,
  type AutomationTargetRef,
  parseAutomationRunRecord,
  parseAutomationTargetRef,
} from "./types";
import {
  type AutomationWorkflow,
  type DriveExportRun,
  parseAutomationWorkflows,
  mutateAutomationWorkflows,
  type WorkflowStep,
  type WorkflowTrigger,
} from "./workflows";

import { getStoredSettingValues, setSettingValue } from "~/settings/queries";

export type { AutomationRunRecord, AutomationTargetRef };
export { parseAutomationRunRecord, parseAutomationTargetRef };

const MAX_PROCESSED_SESSIONS = 50;

export async function runMeetingCompletedAutomations(
  sessionId: string,
): Promise<void> {
  try {
    await runMarkdownExport(sessionId);
  } catch (error) {
    console.error("[automations] meeting.completed run failed", error);
  }
  try {
    await runCustomWorkflows(sessionId, "meeting_completed");
  } catch (error) {
    console.error("[automations] meeting.completed workflows failed", error);
  }
}

export async function runNoteEnhancedAutomations(
  sessionId: string,
): Promise<void> {
  const runners = [runSlackRecap, runLinearIssues, runNotionUpdate];
  for (const runner of runners) {
    try {
      await runner(sessionId);
    } catch (error) {
      console.error("[automations] note.enhanced run failed", error);
    }
  }
  try {
    await runCustomWorkflows(sessionId, "note_enhanced");
  } catch (error) {
    console.error("[automations] note.enhanced workflows failed", error);
  }
}

let workflowQueue: Promise<void> = Promise.resolve();
function enqueueWorkflowRun(run: () => Promise<void>): Promise<void> {
  const next = workflowQueue.then(run);
  workflowQueue = next.catch(() => {});
  return next;
}

function runCustomWorkflows(
  sessionId: string,
  trigger: WorkflowTrigger,
): Promise<void> {
  return enqueueWorkflowRun(() => runCustomWorkflowsNow(sessionId, trigger));
}

async function runCustomWorkflowsNow(
  sessionId: string,
  trigger: WorkflowTrigger,
): Promise<void> {
  const { values } = await getStoredSettingValues();
  const workflows = parseAutomationWorkflows(values.automation_workflows);
  for (const workflow of workflows) {
    if (!workflow.enabled || workflow.trigger !== trigger) {
      continue;
    }
    if (workflow.steps.length === 0) {
      continue;
    }
    if (workflow.steps.some((step) => step.type === "google_drive_export")) {
      if (trigger === "note_enhanced") {
        try {
          await runWorkflowWithFileExports(sessionId, workflow);
        } catch (error) {
          console.error("[automations] Drive workflow run failed", error);
        }
      }
      continue;
    }
    if (
      trigger === "note_enhanced" &&
      workflow.steps.some((step) => step.type === "markdown_export")
    ) {
      try {
        await runWorkflowWithFileExports(sessionId, workflow);
      } catch (error) {
        console.error("[automations] workflow run failed", error);
      }
      continue;
    }
    if (workflow.processedSessionIds.includes(sessionId)) {
      continue;
    }
    try {
      await runWorkflow(sessionId, workflow);
    } catch (error) {
      console.error("[automations] workflow run failed", error);
    }
  }
}

async function runWorkflow(
  sessionId: string,
  workflow: AutomationWorkflow,
): Promise<void> {
  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  let markedSessionId: string | undefined;
  const markProcessed = async () => {
    markedSessionId = sessionId;
    await persistWorkflowResult(workflow.id, { sessionId });
  };
  try {
    const details: string[] = [];
    for (const step of workflow.steps) {
      details.push(
        await executeWorkflowStep(sessionId, step, {
          stepKey: workflowStepKey(workflow, step, sessionId),
          beforeLinearCreate: markProcessed,
        }),
      );
      await markProcessed();
    }
    record.detail = details.filter(Boolean).join(" · ") || "ok";
    await persistWorkflowResult(workflow.id, {
      record,
      sessionId,
    });
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] workflow failed", error);
    await persistWorkflowResult(workflow.id, {
      record,
      sessionId: markedSessionId,
    });
  }
}

async function persistWorkflowResult(
  workflowId: string,
  {
    record,
    sessionId,
  }: {
    record?: AutomationRunRecord;
    sessionId?: string;
  },
): Promise<void> {
  await mutateAutomationWorkflows((workflows) =>
    workflows.map((workflow) => {
      if (workflow.id !== workflowId) return workflow;
      return {
        ...workflow,
        lastRun: record ?? workflow.lastRun,
        processedSessionIds: sessionId
          ? appendProcessedSession(workflow.processedSessionIds, sessionId)
          : workflow.processedSessionIds,
      };
    }),
  );
}

function appendProcessedSession(
  processed: string[],
  sessionId: string,
): string[] {
  if (processed.includes(sessionId)) {
    return processed;
  }
  return [...processed, sessionId].slice(-MAX_PROCESSED_SESSIONS);
}

async function executeWorkflowStep(
  sessionId: string,
  step: WorkflowStep,
  options: { beforeLinearCreate?: () => Promise<void>; stepKey: string },
): Promise<string> {
  if (step.type === "google_drive_export") {
    throw new Error("Google Drive requires the summary-ready workflow runner");
  }
  if (step.type === "markdown_export") {
    const directory = step.directory.trim();
    if (!directory) {
      throw new Error("choose an export folder first");
    }
    if (step.options && !hasMarkdownExportContent(step.options)) {
      throw new Error("choose at least one element to export");
    }
    return await executeConfiguredMarkdownExport(
      sessionId,
      directory,
      step.options,
      options.stepKey,
    );
  }
  if (!step.target) {
    throw new Error(`choose a ${stepLabel(step.type)} first`);
  }
  if (step.type === "slack_recap") {
    return await executeSlackRecap(sessionId, step.target);
  }
  if (step.type === "linear_issues") {
    return await executeLinearIssues(
      sessionId,
      step.target,
      options.beforeLinearCreate,
    );
  }
  return await executeNotionUpdate(sessionId, step.target);
}

function stepLabel(
  type: Exclude<
    WorkflowStep["type"],
    "markdown_export" | "google_drive_export"
  >,
) {
  switch (type) {
    case "slack_recap":
      return "Slack channel";
    case "linear_issues":
      return "Linear team";
    case "notion_update":
      return "Notion page";
  }
}

async function runMarkdownExport(sessionId: string): Promise<void> {
  const { values } = await getStoredSettingValues();
  if (!values.automation_markdown_export_enabled) {
    return;
  }
  const directory = (values.automation_markdown_export_directory ?? "").trim();
  if (!directory) {
    return;
  }

  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  try {
    record.detail = await executeMarkdownExport(sessionId, directory);
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] markdown export failed", error);
  }
  await setSettingValue(
    "automation_markdown_export_last_run",
    JSON.stringify(record),
  );
}

async function runSlackRecap(sessionId: string): Promise<void> {
  const { values } = await getStoredSettingValues();
  if (!values.automation_slack_recap_enabled) {
    return;
  }
  const channel = parseAutomationTargetRef(
    values.automation_slack_recap_channel,
  );
  if (!channel) {
    return;
  }
  const processed = parseProcessedSessions(
    values.automation_slack_recap_processed,
  );
  if (processed.includes(sessionId)) {
    return;
  }

  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  try {
    record.detail = await executeSlackRecap(sessionId, channel);
    await recordProcessedSession(
      "automation_slack_recap_processed",
      processed,
      sessionId,
    );
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] slack recap failed", error);
  }
  await setSettingValue(
    "automation_slack_recap_last_run",
    JSON.stringify(record),
  );
}

async function runLinearIssues(sessionId: string): Promise<void> {
  const { values } = await getStoredSettingValues();
  if (!values.automation_linear_issues_enabled) {
    return;
  }
  const team = parseAutomationTargetRef(values.automation_linear_issues_team);
  if (!team) {
    return;
  }
  const processed = parseProcessedSessions(
    values.automation_linear_issues_processed,
  );
  if (processed.includes(sessionId)) {
    return;
  }

  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  try {
    record.detail = await executeLinearIssues(sessionId, team, () =>
      recordProcessedSession(
        "automation_linear_issues_processed",
        processed,
        sessionId,
      ),
    );
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] linear issues failed", error);
  }
  await setSettingValue(
    "automation_linear_issues_last_run",
    JSON.stringify(record),
  );
}

async function runNotionUpdate(sessionId: string): Promise<void> {
  const { values } = await getStoredSettingValues();
  if (!values.automation_notion_update_enabled) {
    return;
  }
  const page = parseAutomationTargetRef(values.automation_notion_update_page);
  if (!page) {
    return;
  }
  const processed = parseProcessedSessions(
    values.automation_notion_update_processed,
  );
  if (processed.includes(sessionId)) {
    return;
  }

  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  try {
    record.detail = await executeNotionUpdate(sessionId, page);
    await recordProcessedSession(
      "automation_notion_update_processed",
      processed,
      sessionId,
    );
  } catch (error) {
    record.status = "error";
    record.detail = error instanceof Error ? error.message : String(error);
    console.error("[automations] notion update failed", error);
  }
  await setSettingValue(
    "automation_notion_update_last_run",
    JSON.stringify(record),
  );
}

async function executeMarkdownExport(
  sessionId: string,
  directory: string,
  options?: MarkdownExportOptions,
): Promise<string> {
  return (await exportMarkdownFile(sessionId, directory, options, null)).path;
}

async function exportMarkdownFile(
  sessionId: string,
  directory: string,
  options: MarkdownExportOptions | undefined,
  previous: MarkdownExportFile | null,
): Promise<MarkdownExportFile> {
  const result = await localApiCommands.exportMeetingMarkdown(
    sessionId,
    directory,
    options ?? null,
    previous,
  );
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

type StoredMarkdownExportFile = MarkdownExportFile & { key: string };

const MAX_MARKDOWN_EXPORT_FILES = 200;

function workflowStepKey(
  workflow: AutomationWorkflow,
  step: WorkflowStep,
  sessionId: string,
): string {
  return `${workflow.id}:${step.id}:${sessionId}`;
}

// A changed title renames the file, so the exporter replaces the one this step
// wrote last time unless another step now writes to that path.
async function executeConfiguredMarkdownExport(
  sessionId: string,
  directory: string,
  options: MarkdownExportOptions | undefined,
  key: string,
): Promise<string> {
  return await serializeSettingsUpdate(async () => {
    const { values } = await getStoredSettingValues();
    const files = parseMarkdownExportFiles(
      values.automation_markdown_export_files,
    );
    const others = files.filter((file) => file.key !== key);
    const previous = files.find((file) => file.key === key);
    const replaceable =
      previous &&
      !others.some(
        (file) => file.path.toLowerCase() === previous.path.toLowerCase(),
      )
        ? { path: previous.path, sha256: previous.sha256 }
        : null;
    const file = await exportMarkdownFile(
      sessionId,
      directory,
      options,
      replaceable,
    );
    await setSettingValue(
      "automation_markdown_export_files",
      JSON.stringify(
        [...others, { key, ...file }].slice(-MAX_MARKDOWN_EXPORT_FILES),
      ),
    );
    return file.path;
  });
}

let settingsUpdates: Promise<unknown> = Promise.resolve();

// Concurrent runs read and rewrite the same stored list, so run each
// read-modify-write after the previous one finishes.
function serializeSettingsUpdate<T>(update: () => Promise<T>): Promise<T> {
  const next = settingsUpdates.then(update, update);
  settingsUpdates = next.catch(() => undefined);
  return next;
}

function parseMarkdownExportFiles(
  value: string | undefined,
): StoredMarkdownExportFile[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is StoredMarkdownExportFile =>
            typeof entry === "object" &&
            entry !== null &&
            ["key", "path", "sha256"].every(
              (field) =>
                typeof (entry as Record<string, unknown>)[field] === "string",
            ),
        )
      : [];
  } catch {
    return [];
  }
}

// Intégrations cloud (Slack, Linear, Notion, Google Drive) retirées de Syntheo
// Desktop : les étapes encore présentes dans un workflow enregistré échouent
// avec ce message au lieu d'appeler une API distante.
export const CLOUD_STEP_REMOVED_MESSAGE =
  "Intégration cloud retirée de Syntheo : supprimez cette étape du workflow";

async function executeSlackRecap(
  _sessionId: string,
  _channel: AutomationTargetRef,
): Promise<string> {
  throw new Error(CLOUD_STEP_REMOVED_MESSAGE);
}

async function executeLinearIssues(
  _sessionId: string,
  _team: AutomationTargetRef,
  _beforeCreate?: () => Promise<void>,
): Promise<string> {
  throw new Error(CLOUD_STEP_REMOVED_MESSAGE);
}

async function executeNotionUpdate(
  _sessionId: string,
  _page: AutomationTargetRef,
): Promise<string> {
  throw new Error(CLOUD_STEP_REMOVED_MESSAGE);
}

function parseProcessedSessions(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

async function recordProcessedSession(
  settingKey:
    | "automation_linear_issues_processed"
    | "automation_slack_recap_processed"
    | "automation_notion_update_processed",
  processed: string[],
  sessionId: string,
): Promise<void> {
  const next = [...processed, sessionId].slice(-MAX_PROCESSED_SESSIONS);
  await setSettingValue(settingKey, JSON.stringify(next));
}

async function persistDriveRun(
  workflowId: string,
  run: DriveExportRun,
): Promise<void> {
  await mutateAutomationWorkflows((workflows) => {
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new Error("Automation no longer exists");
    const runs = (workflow.driveExports ?? []).filter(
      (item) =>
        !(
          item.stepId === run.stepId &&
          item.sessionId === run.sessionId &&
          item.folderId === run.folderId &&
          item.connectionId === run.connectionId &&
          (item.format ?? "markdown") === (run.format ?? "markdown")
        ),
    );
    runs.push(run);
    // Preserve unresolved file IDs across ambiguous uploads and restarts.
    const completed = runs
      .filter((item) => item.status === "success")
      .slice(-50);
    workflow.driveExports = [
      ...completed,
      ...runs.filter((item) => item.status !== "success"),
    ];
    return workflows;
  });
}

async function executeDriveStep(
  sessionId: string,
  workflow: AutomationWorkflow,
  step: Extract<WorkflowStep, { type: "google_drive_export" }>,
): Promise<DriveExportRun> {
  if (!step.target || !step.connectionId)
    throw new Error("Choose a Google Drive folder first");
  const previous = workflow.driveExports?.find(
    (run) =>
      run.sessionId === sessionId &&
      run.stepId === step.id &&
      run.connectionId === step.connectionId &&
      run.folderId === step.target?.id &&
      (run.format ?? "markdown") === (step.format ?? "markdown"),
  );
  const run: DriveExportRun = {
    sessionId,
    stepId: step.id,
    connectionId: step.connectionId,
    folderId: step.target.id,
    fileId: previous?.fileId,
    format: step.format ?? "markdown",
    status: "pending",
    detail: "",
    at: new Date().toISOString(),
  };
  run.status = "error";
  run.detail = CLOUD_STEP_REMOVED_MESSAGE;
  run.at = new Date().toISOString();
  await persistDriveRun(workflow.id, run);
  return run;
}

// File exports overwrite the same file, so they rerun on every regenerated
// summary. Steps that post or create something run once per session.
async function runWorkflowWithFileExports(
  sessionId: string,
  workflow: AutomationWorkflow,
): Promise<void> {
  const skipOtherSteps = workflow.processedSessionIds.includes(sessionId);
  const record: AutomationRunRecord = {
    at: new Date().toISOString(),
    status: "success",
    detail: "",
  };
  const details: string[] = [];
  for (const step of workflow.steps) {
    if (step.type === "google_drive_export") {
      const run = await executeDriveStep(sessionId, workflow, step);
      if (run.status === "error") record.status = "error";
      details.push(run.detail);
    } else if (!skipOtherSteps || step.type === "markdown_export") {
      try {
        details.push(
          await executeWorkflowStep(sessionId, step, {
            stepKey: workflowStepKey(workflow, step, sessionId),
            beforeLinearCreate: () =>
              persistWorkflowResult(workflow.id, { sessionId }),
          }),
        );
        await persistWorkflowResult(workflow.id, { sessionId });
      } catch (error) {
        record.status = "error";
        details.push(error instanceof Error ? error.message : String(error));
        break;
      }
    }
  }
  record.detail = details.join(" · ");
  await persistWorkflowResult(workflow.id, { record });
}

export function retryDriveExport(
  workflowId: string,
  failed: DriveExportRun,
): Promise<void> {
  return enqueueWorkflowRun(async () => {
    const { values } = await getStoredSettingValues();
    const workflow = parseAutomationWorkflows(values.automation_workflows).find(
      (item) => item.id === workflowId,
    );
    if (!workflow?.enabled || workflow.trigger !== "note_enhanced")
      throw new Error("Enable the summary-ready automation before retrying");
    const step = workflow.steps.find((item) => item.id === failed.stepId);
    if (
      step?.type !== "google_drive_export" ||
      step.connectionId !== failed.connectionId ||
      step.target?.id !== failed.folderId ||
      (step.format ?? "markdown") !== (failed.format ?? "markdown")
    ) {
      throw new Error(
        "The Drive destination or format has changed. Generate the summary again to export to the new folder.",
      );
    }
    const run = await executeDriveStep(failed.sessionId, workflow, step);
    await persistWorkflowResult(workflow.id, {
      record: {
        at: run.at,
        status: run.status === "success" ? "success" : "error",
        detail: run.detail,
      },
    });
    if (run.status === "error") throw new Error(run.detail);
  });
}
