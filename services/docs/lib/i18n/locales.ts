export {
  ALL_LOCALES,
  detectInitialLocale,
  isUrlPrefixedLocale,
  resolveRegionalLocale,
} from '@tale/ui/i18n/detect-locale';
export type { Locale, SupportedLocale } from '@tale/ui/i18n/detect-locale';

import type { SupportedLocale } from '@tale/ui/i18n/detect-locale';

export const BASE_LOCALES = [
  'en',
  'de',
  'fr',
] as const satisfies readonly SupportedLocale[];
