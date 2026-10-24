import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Garde-fou : Syntheo Desktop n'a ni compte ni fonction cloud. Aucun fichier de
// production ne doit réimporter un module cloud retiré ni viser anarlog.so.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const SRC = join(process.cwd(), "src");

const FORBIDDEN = [
  "~/session-sharing",
  "~/shared-notes",
  "~/resource-sharing",
  "~/cloud-api",
  "~/attachment-sync",
  "~/enterprise-capture",
  "~/settings/team",
  "~/auth/cloudsync",
  "~/auth/useConnections",
  "~/auth/sync-devices",
  "anarlog.so",
  "useConnections",
  "requireTeamContext",
  "useAuthedApiClient",
];

const REMOVED_DIRS = [
  "session-sharing",
  "shared-notes",
  "resource-sharing",
  "cloud-api",
  "attachment-sync",
  "enterprise-capture",
  "settings/team",
];

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "i18n" ? [] : productionFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|\.gen\./.test(name)
      ? [path]
      : [];
  });
}

describe("no cloud features", () => {
  it("has no production import of a removed cloud module", () => {
    const offenders = productionFiles(SRC)
      .map((path) => ({
        file: relative(SRC, path),
        hits: FORBIDDEN.filter((needle) =>
          readFileSync(path, "utf8").includes(needle),
        ),
      }))
      .filter(({ file, hits }) => hits.length > 0 && file !== "no-cloud-imports.test.ts");
    expect(offenders).toEqual([]);
  });

  it("has deleted the cloud feature folders", () => {
    const remaining = REMOVED_DIRS.filter((dir) => {
      try {
        return statSync(join(SRC, dir)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(remaining).toEqual([]);
  });
});
