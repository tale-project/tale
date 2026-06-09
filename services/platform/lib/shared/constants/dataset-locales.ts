/**
 * Single source of truth for the locale set covered by the detection datasets
 * (reasoning lexicon + routing domain keywords).
 *
 * NOTE: distinct from the UI `SUPPORTED_LOCALES` (`en`/`de`/`fr`) — these are
 * detection datasets, matched against arbitrary user input across many
 * languages, not translated UI copy.
 *
 * Codes mirror the lexicon's `locale` field. The `DATASET_BOUNDARY_MODE` table
 * is the canonical word-vs-substring decision per locale; a dataset whose file
 * declares a different mode is a bug (asserted by the structural tests).
 */

import type { BoundaryMode } from '../text-matching';

export const SUPPORTED_DATASET_LOCALES = [
  'ar',
  'bg',
  'bn',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'ms',
  'nb',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'th',
  'tl',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh-Hans',
  'zh-Hant',
] as const;

type DatasetLocale = (typeof SUPPORTED_DATASET_LOCALES)[number];

/**
 * Locales whose script does not separate words with spaces, so terms are
 * matched as raw substrings rather than with Unicode word boundaries.
 * Everything not listed defaults to `'word'`.
 */
const SUBSTRING_LOCALES: ReadonlySet<string> = new Set<DatasetLocale>([
  'ja',
  'ko',
  'th',
  'zh-Hans',
  'zh-Hant',
]);

/** Canonical boundary mode for a dataset locale. */
export function boundaryModeFor(locale: string): BoundaryMode {
  return SUBSTRING_LOCALES.has(locale) ? 'substring' : 'word';
}
