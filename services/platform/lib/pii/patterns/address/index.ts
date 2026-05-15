/**
 * Postal-address detection.
 *
 * Detection strategy
 *   - For each enabled locale, the form composer reads the JSON config and
 *     emits regex source strings for the form shapes the locale declares
 *     (`glued-suffix`, `inverted`, `standard`, `po-box`, `lieu-dit`, …).
 *   - All per-locale forms across all enabled locales are joined with `|`,
 *     and a shared optional tail (floor + postcode+city + country) is
 *     appended. The result compiles with `giu`.
 *   - A `validate` post-filter rejects matches with no uppercase letter
 *     when at least one enabled locale requires it (Title-Case gate).
 *     Locales whose scripts have no case distinction (CJK, Arabic) opt
 *     out via `address.requireUppercase: false` in their JSON.
 *
 * Why the validator instead of regex lookaheads
 *   - The composed regex is compiled with `/giu`. The `i` flag case-folds
 *     every character class containing uppercase letters (ECMA-262 §22.2.2),
 *     so embedding `\p{Lu}` or `[A-Z]` lookaheads inside the regex is a
 *     no-op. The validator runs after the match, where case sensitivity
 *     applies normally.
 *
 * Locale coverage
 *   - All declarative: every keyword set lives in `locales/data/<code>.ts`.
 *     Phase 1 shipped en, de, fr, it, nl; later phases add locales by
 *     adding typed data modules only.
 */

import type { PiiPattern, PiiPatternFactory } from '../../core/types';
import { composeAddressRegex } from './compose';

/**
 * Compiled-regex cache keyed by the sorted locale-code set.
 *
 * `composeAddressRegex` keeps its own inner cache, but every call still
 * allocates the cache key. Hoisting the lookup here lets `addressFactory`
 * short-circuit on the very first instruction when the same locale set is
 * reused — mirrors `PHONE_REGEX_CACHE` in `patterns/phone.ts:104-126`.
 */
const ADDRESS_REGEX_CACHE = new Map<string, RegExp>();

export const addressFactory: PiiPatternFactory = (locales) => {
  if (locales.length === 0) return [];

  const cacheKey = locales
    .map((l) => l.locale)
    .slice()
    .sort()
    .join(',');
  let regex = ADDRESS_REGEX_CACHE.get(cacheKey);
  if (!regex) {
    regex = composeAddressRegex(locales);
    ADDRESS_REGEX_CACHE.set(cacheKey, regex);
  }

  // Title-Case gate is enabled if ANY locale in the set requires it.
  // For mixed sets (e.g. de + ja), the gate only filters Latin-script
  // matches; CJK matches that don't contain Latin uppercase still pass
  // because they were anchored on a postcode-anchored form which has its
  // own discriminator.
  const requiresUppercase = locales.some((l) => l.address.requireUppercase);

  const pattern: PiiPattern = {
    name: 'address',
    regex,
    validate: requiresUppercase
      ? (m) => /[A-Z]/.test(m) || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(m)
      : undefined,
    replacement: '[ADDRESS]',
  };
  return [pattern];
};
