/**
 * CLDR plural-category data per locale.
 *
 * Used by `icu-plural-rules` to verify that a locale value provides the
 * categories its language requires. Categories listed are the
 * morphologically distinct CLDR forms. Exact-match clauses (`=0`, `=1`)
 * are always permitted in addition to these categories, and `=1` gives
 * `one`.
 *
 * Source: CLDR's `plurals.xml`. Conservative — only the categories the
 * locale's plural function distinguishes. `other` is always required.
 * French `many` is not: CLDR uses it only for exact multiples of a
 * million, and the formatter falls back to `other` when a branch is absent.
 */

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

const REQUIRED_PLURAL_CATEGORIES: Record<
  string,
  ReadonlyArray<PluralCategory>
> = {
  en: ['one', 'other'],
  de: ['one', 'other'],
  'de-CH': ['one', 'other'],
  fr: ['one', 'other'],
};

/** Get required categories for a locale; falls back to ['one','other']. */
export function requiredCategories(
  locale: string,
): ReadonlyArray<PluralCategory> {
  return REQUIRED_PLURAL_CATEGORIES[locale] ?? ['one', 'other'];
}
