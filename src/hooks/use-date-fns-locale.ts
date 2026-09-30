'use client';

import type { Locale } from 'date-fns';
import { de } from 'date-fns/locale/de';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import { useTranslation } from 'react-i18next';

/**
 * The date-fns locale for a UI language tag. Only the base language counts:
 * the app speaks English, German and French, and a regional variant such as
 * `de-CH` is a message overlay on its base, so its calendar is the German
 * one. Anything else falls back to US English, the UI's own fallback.
 *
 * The locale decides more than words: German and French weeks start on a
 * Monday, the US week on a Sunday.
 */
export function dateFnsLocaleFor(language: string | undefined): Locale {
  switch (language?.toLowerCase().split(/[-_]/)[0]) {
    case 'de':
      return de;
    case 'fr':
      return fr;
    default:
      return enUS;
  }
}

/**
 * The date-fns locale of the active UI language, for a control that formats
 * dates itself (the date pickers). It reads the i18n instance rather than the
 * `LocaleProvider`, so it follows every language switch and also works in a
 * service that takes its locale from the URL and mounts no provider.
 */
export function useDateFnsLocale(): Locale {
  const { i18n } = useTranslation();
  return dateFnsLocaleFor(i18n?.resolvedLanguage ?? i18n?.language);
}
