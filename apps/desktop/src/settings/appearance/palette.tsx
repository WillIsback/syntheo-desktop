import { Trans, useLingui } from "@lingui/react/macro";
import { type KeyboardEvent, useId, useRef } from "react";

import { DesignPalettes, PALETTE_IDS } from "@syntheo/design-system";
import { Check } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import { useSetSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import {
  applyDocumentPalette,
  normalizePalette,
  type PaletteId,
  writeStoredPalette,
} from "~/shared/theme/palette";

// Nom japonais de chaque palette (maquette parcours-note.html, objet PAL) :
// décoratif, rendu en font-kanji et masqué des lecteurs d'écran.
const KANJI: Record<PaletteId, string> = {
  cha: "緑茶",
  fuji: "藤",
  enji: "臙脂",
};

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

export function PaletteSelector() {
  const { t } = useLingui();
  const baseId = useId();
  const value = normalizePalette(useConfigValue("palette"));
  const setPalette = useSetSettingValue("palette");
  const radios = useRef<Partial<Record<PaletteId, HTMLButtonElement | null>>>(
    {},
  );
  const labels: Record<PaletteId, { name: string; description: string }> = {
    cha: {
      name: t`Green tea`,
      description: t`Pine green on raw silk, with ink. Calm and plant-like.`,
    },
    fuji: {
      name: t`Wisteria`,
      description: t`Edo purple and pale wisteria. Elegant, a little more singular.`,
    },
    enji: {
      name: t`Lacquer and ink`,
      description: t`Lacquer red and cherry blossom pink. The most contrasted.`,
    },
  };

  const select = (palette: PaletteId) => {
    applyDocumentPalette(palette);
    writeStoredPalette(palette);
    setPalette(palette);
  };

  // Groupe radio : une seule tabulation, flèches pour changer (et choisir).
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = PALETTE_IDS.indexOf(value);
    let next: number | null = null;
    if (NEXT_KEYS.has(event.key)) next = (index + 1) % PALETTE_IDS.length;
    if (PREVIOUS_KEYS.has(event.key)) {
      next = (index - 1 + PALETTE_IDS.length) % PALETTE_IDS.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = PALETTE_IDS.length - 1;
    if (next === null) return;

    event.preventDefault();
    const palette = PALETTE_IDS[next];
    select(palette);
    radios.current[palette]?.focus();
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">
          <Trans>Palette</Trans>
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          <Trans>
            Choose the colors of Syntheo. Each palette follows the light or dark
            theme.
          </Trans>
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={t`Color palette`}
        className="grid gap-3 sm:grid-cols-3"
      >
        {PALETTE_IDS.map((id) => {
          const selected = value === id;
          const colors = DesignPalettes[id].light;
          const swatches = [
            colors.background,
            colors.primary,
            colors.accent,
            colors.foreground,
            colors.recording,
          ];

          return (
            <button
              key={id}
              ref={(element) => {
                radios.current[id] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-labelledby={`${baseId}-${id}-name`}
              aria-describedby={`${baseId}-${id}-description`}
              tabIndex={selected ? 0 : -1}
              data-palette-option={id}
              className={cn([
                "bg-background text-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex cursor-pointer flex-col gap-2.5 rounded-2xl border p-3 text-left transition-[background-color,border-color,box-shadow,scale] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]",
                selected
                  ? "border-foreground/50 bg-accent/40 shadow-xs"
                  : "border-border hover:border-foreground/30 hover:bg-accent/20",
              ])}
              onClick={() => select(id)}
              onKeyDown={onKeyDown}
            >
              <span className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  data-palette-kanji
                  className="font-kanji text-xl leading-none font-bold"
                >
                  {KANJI[id]}
                </span>
                <span
                  id={`${baseId}-${id}-name`}
                  className="min-w-0 flex-1 text-sm font-medium"
                >
                  {labels[id].name}
                </span>
                <span
                  aria-hidden="true"
                  className={cn([
                    "bg-foreground text-background flex size-5 shrink-0 items-center justify-center self-center rounded-full transition-[filter,opacity,scale] duration-150",
                    selected
                      ? "scale-100 opacity-100 blur-none"
                      : "scale-25 opacity-0 blur-[4px]",
                  ])}
                >
                  <Check className="size-3" weight="bold" />
                </span>
              </span>
              <span
                aria-hidden="true"
                className="border-border flex h-[22px] overflow-hidden rounded-md border"
              >
                {swatches.map((color, index) => (
                  <span
                    key={index}
                    data-palette-swatch
                    className={index === 0 ? "flex-[2.2]" : "flex-1"}
                    style={{ background: color }}
                  />
                ))}
              </span>
              <span
                id={`${baseId}-${id}-description`}
                className="text-muted-foreground text-xs leading-snug"
              >
                {labels[id].description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
