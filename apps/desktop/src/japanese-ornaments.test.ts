import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Clins d'œil japonais (design/refonte-the-vert/identite.md) : décoratifs,
// toujours aria-hidden, au plus un par zone, et seulement à trois endroits :
// capsule (備 聴 結), filigrane de l'accueil (茶), sceau de note terminée (記).
const SRC = join(process.cwd(), "src");
const KANJI = /[茶備聴結記]/;

const ALLOWED: Record<string, string> = {
  "home/home-view.tsx": "filigrane 茶",
  "session/components/capsule/index.tsx": "étapes 備 聴 結",
  "session/components/living-document/provenance.tsx": "sceau 記",
};

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "i18n" ? [] : productionFiles(path);
    }
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("clins d'œil japonais", () => {
  it("n'apparaissent qu'à la capsule, à l'accueil et au sceau", () => {
    const offenders = productionFiles(SRC)
      .filter((path) => KANJI.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
      .filter((file) => !(file in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(ALLOWED))(
    "%s les rend en font-kanji et aria-hidden",
    (file) => {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source).toContain("font-kanji");
      expect(source).toContain('aria-hidden="true"');
    },
  );
});
