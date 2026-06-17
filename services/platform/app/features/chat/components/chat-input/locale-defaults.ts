// Web Speech requires a fully-qualified BCP-47 tag. Already-regional codes
// (`de-CH`, future `fr-CA`) pass through; bare base locales pick the most
// common region default. Unknown locales fall back to en-US at the call site.
const BASE_LOCALE_DEFAULTS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
};

export function toBcp47(locale: string): string | undefined {
  if (locale.includes('-')) return locale;
  return BASE_LOCALE_DEFAULTS[locale];
}
