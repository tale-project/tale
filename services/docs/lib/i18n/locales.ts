export {
  ALL_LOCALES,
  detectInitialLocale,
  isUrlPrefixedLocale,
  REGIONAL_LOCALES,
  resolveRegionalLocale,
} from '@tale/webui/i18n/locales';
export type {
  Locale,
  RegionalLocale,
  SupportedLocale,
} from '@tale/webui/i18n/locales';

import type { SupportedLocale } from '@tale/webui/i18n/locales';

export const BASE_LOCALES = [
  'en',
  'de',
  'fr',
] as const satisfies readonly SupportedLocale[];
