export {
  ALL_LOCALES,
  detectInitialLocale,
  isUrlPrefixedLocale,
  resolveRegionalLocale,
  SUPPORTED_LOCALES,
} from '@tale/ui/i18n/detect-locale';
export type { Locale, SupportedLocale } from '@tale/ui/i18n/detect-locale';

import { SUPPORTED_LOCALES } from '@tale/ui/i18n/detect-locale';
import type { SupportedLocale } from '@tale/ui/i18n/detect-locale';

/** URL-bearing docs locales — same set as {@link SUPPORTED_LOCALES}. */
export const BASE_LOCALES =
  SUPPORTED_LOCALES satisfies readonly SupportedLocale[];
