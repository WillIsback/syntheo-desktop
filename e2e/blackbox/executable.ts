import { accessSync, constants } from "node:fs";
import path from "node:path";

const executableExtensions =
  process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com"] : [""];

// Resolve a command against PATH once so child_process always receives an
// absolute executable path. This keeps PATH-based discovery for local tooling
// without handing an unvalidated command name to spawn().
export function resolveExecutable(command: string): string {
  if (command.includes(path.sep) || command.includes("/")) {
    return command;
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of executableExtensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep searching the remaining PATH entries.
      }
    }
  }

  return command;
}
