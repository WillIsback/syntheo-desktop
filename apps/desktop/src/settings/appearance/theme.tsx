import { Trans, useLingui } from "@lingui/react/macro";

import { DesignColors } from "@syntheo/design-system";
import { Check } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import { useSetSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";
import { normalizeAppIconPreference } from "~/shared/theme/icon";
import { applyThemePreference } from "~/shared/theme/provider";
import type { ThemePreference } from "~/shared/theme/resolve";

const THEME_OPTIONS = [
  "light",
  "dark",
  "system",
] as const satisfies readonly ThemePreference[];

export function ThemeSelector() {
  const { t } = useLingui();
  const storedValue = useConfigValue("theme") as ThemePreference;
  const value = THEME_OPTIONS.includes(storedValue) ? storedValue : "system";
  const appIcon = normalizeAppIconPreference(useConfigValue("app_icon"));
  const setTheme = useSetSettingValue("theme");
  const options = [
    { value: "light", label: t`Light`, description: t`Bright canvas` },
    { value: "dark", label: t`Dark`, description: t`Low-light canvas` },
    { value: "system", label: t`System`, description: t`Match your device` },
  ] as const satisfies readonly {
    value: ThemePreference;
    label: string;
    description: string;
  }[];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">
          <Trans>Theme</Trans>
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          <Trans>Choose how Syntheo looks on this device.</Trans>
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={t`Color theme`}
        className="grid gap-3 sm:grid-cols-3"
      >
        {options.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn([
                "group bg-background text-foreground focus-visible:ring-ring focus-visible:ring-offset-background relative cursor-pointer overflow-hidden rounded-2xl border text-left transition-[background-color,border-color,box-shadow,scale] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]",
                selected
                  ? "border-foreground/50 bg-accent/40 shadow-xs"
                  : "border-border hover:border-foreground/30 hover:bg-accent/20",
              ])}
              onClick={() => {
                void applyThemePreference(option.value, appIcon);
                setTheme(option.value);
              }}
            >
              <ThemePreview theme={option.value} />
              <div className="border-border flex items-center gap-2 border-t p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{option.label}</div>
                  <div className="text-muted-foreground text-xs">
                    {option.description}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className={cn([
                    "bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full transition-[filter,opacity,scale] duration-150",
                    selected
                      ? "scale-100 opacity-100 blur-none"
                      : "scale-25 opacity-0 blur-[4px]",
                  ])}
                >
                  <Check className="size-3" weight="bold" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  return (
    <div aria-hidden="true" className="relative h-28 overflow-hidden">
      <PreviewCanvas dark={theme === "dark"} />
      {theme === "system" ? (
        <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
          <PreviewCanvas dark />
        </div>
      ) : null}
    </div>
  );
}

function PreviewCanvas({ dark }: { dark: boolean }) {
  // L'aperçu montre la palette du thème choisi, pas celle du thème courant :
  // on lit donc les jetons TypeScript plutôt que les variables CSS.
  const c = dark ? DesignColors.dark : DesignColors.light;
  return (
    <div
      className="absolute inset-0 flex flex-col p-3"
      style={{ background: c.background, color: c.foreground }}
    >
      <div className="mb-3 flex gap-1">
        <span
          className="size-1.5 rounded-full"
          style={{ background: c.recording }}
        />
        <span
          className="size-1.5 rounded-full"
          style={{ background: c.faint }}
        />
        <span
          className="size-1.5 rounded-full"
          style={{ background: c.primary }}
        />
      </div>
      <div className="flex flex-1 gap-3">
        <div className="w-1/4 rounded-md" style={{ background: c.muted }} />
        <div className="flex flex-1 flex-col gap-2 py-1">
          <span
            className="h-1.5 w-10 rounded-full"
            style={{ background: c.foreground }}
          />
          <span
            className="h-1 w-4/5 rounded-full"
            style={{ background: c.border }}
          />
          <span
            className="h-1 w-3/5 rounded-full"
            style={{ background: c.border }}
          />
          <span
            className="h-1 w-2/3 rounded-full"
            style={{ background: c.aiInk }}
          />
        </div>
      </div>
    </div>
  );
}
