export {
  ALL_LOCALES,
  detectInitialLocale,
  isUrlPrefixedLocale,
  resolveRegionalLocale,
} from '@tale/ui/i18n/locales';
export type { Locale, SupportedLocale } from '@tale/ui/i18n/locales';

import type { SupportedLocale } from '@tale/ui/i18n/locales';

export const BASE_LOCALES = [
  'en',
  'de',
  'fr',
] as const satisfies readonly SupportedLocale[];
