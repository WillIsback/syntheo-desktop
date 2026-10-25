import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou : Syntheo Desktop ne conserve jamais l'audio d'une capture. Rien
// à relire, donc ni lecteur, ni retranscription, ni modèle « après
// l'enregistrement » qui exigerait l'audio complet.
// Vitest s'exécute depuis apps/desktop (environnement jsdom, pas d'URL file:).
const SRC = join(process.cwd(), "src");

const FORBIDDEN = [
  "~/audio-player",
  "useRegenerateTranscript",
  "prepareSessionPeaks",
  "requiresRetainedBatchAudio",
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

describe("no audio at rest", () => {
  it("no_audio_playback_or_retranscription", () => {
    const offenders = productionFiles(SRC)
      .map((path) => ({
        file: relative(SRC, path),
        hits: FORBIDDEN.filter((needle) =>
          readFileSync(path, "utf8").includes(needle),
        ),
      }))
      .filter(
        ({ file, hits }) =>
          hits.length > 0 && file !== "no-audio-at-rest.test.ts",
      );
    expect(offenders).toEqual([]);
    expect(() => statSync(join(SRC, "audio-player"))).toThrow();
  });
});
