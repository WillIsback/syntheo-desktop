export const SOURCE_LOCALE = "en";

export const SUPPORTED_DISPLAY_LOCALES = ["en", "fr"] as const;

export type DisplayLocale = (typeof SUPPORTED_DISPLAY_LOCALES)[number];

const supportedDisplayLocales = new Set<string>(SUPPORTED_DISPLAY_LOCALES);
const supportedDisplayLocaleByLanguage = new Map(
  SUPPORTED_DISPLAY_LOCALES.map(
    (locale) => [new Intl.Locale(locale).language, locale] as const,
  ),
);

// Français d'abord : la locale d'affichage est le français, sauf si la langue
// choisie est explicitement l'anglais. Les autres langues de transcription
// (allemand, espagnol…) n'ont pas de catalogue et retombent sur le français.
export function resolveDisplayLocale(
  language: string | null | undefined,
): DisplayLocale {
  if (language) {
    try {
      const locale = new Intl.Locale(language);
      const exactLocale = locale.toString();
      if (supportedDisplayLocales.has(exactLocale)) {
        return exactLocale as DisplayLocale;
      }
      const byLanguage = supportedDisplayLocaleByLanguage.get(locale.language);
      if (byLanguage) {
        return byLanguage;
      }
      if (locale.language === "en") {
        return "en";
      }
    } catch {
      // langue invalide : on retombe sur le français
    }
  }

  return "fr";
}
