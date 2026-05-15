/**
 * Locale registry.
 *
 * Each locale ships as a typed `LocaleConfig` const in `./data/<code>.ts`.
 * The data module exports `ALL_LOCALES`, an array iterated here once at
 * module load to build the lookup map.
 *
 * Why typed TS modules (not JSON)
 *   - The old JSON files required a runtime `import … with { type: 'json' }`
 *     pass and a Zod validation step at module load — pure overhead for a
 *     shape TypeScript already verifies at compile time. Moving to TS
 *     lets `tsc` catch drift (renamed enum value, dropped field) before a
 *     bundle is ever shipped, and lets the Convex bundler emit a single
 *     JS chunk without the JSON-source-tree workaround the Dockerfile
 *     used to need.
 *   - Comments are now allowed inside the locale data — useful for
 *     explaining why a particular keyword is included or excluded.
 *
 * National-ID safety check
 *   - Regex sources still pass through `new RegExp` + `safe-regex2` once
 *     per locale on first lookup (fail-open: drop the offending spec,
 *     warn). This stays runtime-only because regex-safety is a property
 *     of the string at execution time, not the type at compile time.
 *
 * Composition helpers
 *   - `composeKeywordAlternation` joins keyword arrays from N locales into
 *     a single regex alternation, longest-first ordered so JavaScript's
 *     leftmost-first match-eval favors the more specific keyword.
 */

import safe from 'safe-regex2';

import { escapeRegExp } from '../core/regex-safety';
import type { LocaleCode } from '../core/types';
import { ALL_LOCALES } from './data';
import type { AddressFormShape, LocaleConfig, NationalIdSpec } from './types';

// -----------------------------------------------------------------------------
// Locale map — built lazily on first access so module load cost stays flat.
//
// Building the map iterates ALL_LOCALES and runs the per-spec
// `safe-regex2` check on every national-ID pattern. With 43 locales and
// dozens of national-IDs each, that work is non-trivial — but the
// vast majority of consumers never touch locale-aware patterns (email +
// IP + credit-card + IBAN all ignore locales). Lazy construction keeps
// "just import the schema" callers near-free.
// -----------------------------------------------------------------------------

let LOCALES_CACHE: Map<string, LocaleConfig> | null = null;

function getLocales(): Map<string, LocaleConfig> {
  if (LOCALES_CACHE) return LOCALES_CACHE;
  const m = new Map<string, LocaleConfig>();
  for (const cfg of ALL_LOCALES) {
    // National-ID regex sources are still untrusted: they're strings that
    // get compiled with `new RegExp(...)` at use time, and a pathological
    // pattern can exhaust the wall-clock budget. Two checks per spec:
    //   (1) the source must compile;
    //   (2) `safe-regex2` AST analysis must accept it.
    // Fail-open: drop the offending spec rather than throw, so a single
    // bad entry can't take down module load. The warning names only
    // `locale` + `id`; the pattern source itself can leak ID-template
    // structure and must never reach the log.
    const safeIds: NationalIdSpec[] = [];
    for (const spec of cfg.nationalIds) {
      try {
        // Compile only to validate syntax; the pattern is recompiled with
        // the `g` flag at use time in `national-ids/index.ts`. `void` so
        // the construction's side-effect (throwing on bad syntax) drives
        // the check without holding the unused regex reference.
        void new RegExp(spec.pattern);
      } catch {
        console.warn(
          `[pii] dropping invalid nationalId regex in locale "${cfg.locale}": ${spec.id}`,
        );
        continue;
      }
      if (!safe(spec.pattern)) {
        console.warn(
          `[pii] dropping unsafe nationalId regex in locale "${cfg.locale}": ${spec.id}`,
        );
        continue;
      }
      safeIds.push(spec);
    }
    m.set(
      cfg.locale,
      safeIds.length === cfg.nationalIds.length
        ? cfg
        : { ...cfg, nationalIds: safeIds },
    );
  }
  LOCALES_CACHE = m;
  return m;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/** Lookup one locale config by code. Throws if the code is unknown. */
export function loadLocale(code: LocaleCode): LocaleConfig {
  const locales = getLocales();
  const cfg = locales.get(code);
  if (!cfg) {
    throw new Error(
      `[pii] unknown locale code: ${code}. Known: ${[...locales.keys()].join(', ')}`,
    );
  }
  return cfg;
}

/** List every locale code the library has data for. */
export function listLocales(): LocaleCode[] {
  return [...getLocales().keys()];
}

/**
 * Resolve a locale selector into an explicit list of configs.
 *
 * `'*'` means "every locale". Otherwise an array of locale codes — each
 * resolved via `loadLocale` so unknown codes fail loudly.
 */
export function resolveLocales(selector: LocaleCode[] | '*'): LocaleConfig[] {
  if (selector === '*') return [...getLocales().values()];
  return selector.map(loadLocale);
}

// -----------------------------------------------------------------------------
// Composition helpers — used by pattern composers to build runtime regex
//
// Cache-key strategy (for callers, not this module):
//   Address and CVC composers use a cheap locale-code-only cache key
//   (`locales.map(l => l.locale).sort().join(',')`) because their keyword
//   sets are fixed at module load and never mutated — the locale code
//   uniquely identifies the data.
//
//   Phone and DOB composers use a full `JSON.stringify` key that includes
//   the actual keyword arrays / DOB config. This is necessary because
//   those composers read per-locale fields that an embedder _could_
//   override at runtime via `PatternRegistry` without changing the locale
//   code. The JSON key ensures a cache miss when the underlying data
//   changes, at the cost of one extra allocation per `createScrubber`
//   call (amortised to zero on cache hit).
// -----------------------------------------------------------------------------

/**
 * Build a regex alternation from one or more keyword lists.
 *
 * Behaviour:
 *   - All keywords from every locale are merged and de-duplicated.
 *   - Longest-first ordering — JavaScript leftmost-first alternation
 *     favors the keyword listed earlier, so multi-word keywords
 *     (`P.O. Box`) must precede their substrings (`Box`).
 *   - Each keyword is regex-escaped — keyword data contains literals, not
 *     regex. The composer is the boundary that turns literals into regex
 *     source.
 *
 * Returns a string suitable for embedding inside a larger pattern.
 * Empty input returns `(?!)` (a regex that never matches) so calling
 * code can compose unconditionally.
 */
export function composeKeywordAlternation(
  keywordLists: ReadonlyArray<readonly string[] | undefined>,
): string {
  const merged = new Set<string>();
  for (const list of keywordLists) {
    if (!list) continue;
    for (const kw of list) {
      if (kw.length > 0) merged.add(kw);
    }
  }
  if (merged.size === 0) return '(?!)';
  const ordered = [...merged].sort((a, b) => b.length - a.length);
  return ordered.map(escapeRegExp).join('|');
}

/** Re-export types for consumers. */
export type { AddressFormShape, LocaleConfig };
