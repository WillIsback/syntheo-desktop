export const SOURCE_LOCALE = "en";

export const SUPPORTED_DISPLAY_LOCALES = ["en", "fr"] as const;

export type DisplayLocale = (typeof SUPPORTED_DISPLAY_LOCALES)[number];

const supportedDisplayLocales = new Set<string>(SUPPORTED_DISPLAY_LOCALES);
const supportedDisplayLocaleByLanguage = new Map(
  SUPPORTED_DISPLAY_LOCALES.map(
    (locale) => [new Intl.Locale(locale).language, locale] as const,
  ),
);

export function resolveDisplayLocale(
  language: string | null | undefined,
): DisplayLocale {
  if (!language) {
    return SOURCE_LOCALE;
  }

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(language);
  } catch {
    return SOURCE_LOCALE;
  }

  const exactLocale = locale.toString();
  if (supportedDisplayLocales.has(exactLocale)) {
    return exactLocale as DisplayLocale;
  }

  return supportedDisplayLocaleByLanguage.get(locale.language) ?? SOURCE_LOCALE;
}
