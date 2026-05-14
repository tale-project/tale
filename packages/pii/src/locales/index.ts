/**
 * Locale registry.
 *
 * Loads every JSON file under `./data/`, validates it against the
 * `LocaleConfig` schema, and exposes lookup helpers.
 *
 * Loading strategy
 *   - JSON imports are resolved eagerly so we get a single up-front Zod
 *     validation pass at module load. Lazy loading would trade startup
 *     cost for the risk of detection-time failures on a malformed
 *     locale.
 *   - Bun and modern bundlers strip unused JSON imports automatically;
 *     consumers that only enable a subset of locales pay only for what
 *     they enable in the final bundle.
 *
 * Composition helpers
 *   - `composeKeywordAlternation` joins keyword arrays from N locales into
 *     a single regex alternation, longest-first ordered so JavaScript's
 *     leftmost-first match-eval favors the more specific keyword.
 *   - `composeCountryNamesAlternation` does the same for country names.
 */

import safe from 'safe-regex2';
import { z } from 'zod';

import { escapeRegExp } from '../core/regex-safety';
import type { LocaleCode } from '../core/types';
import type {
  AddressFormShape,
  DateOfBirthConfig,
  LocaleAddressConfig,
  LocaleConfig,
  NationalIdSpec,
  PostcodeForm,
  Script,
} from './types';

// -----------------------------------------------------------------------------
// Zod schema — runtime validation for the JSON files
// -----------------------------------------------------------------------------

const scriptSchema = z.enum([
  'latn',
  'cyrl',
  'grek',
  'arab',
  'hebr',
  'jpan',
  'hans',
  'hant',
  'kore',
  'thai',
  'deva',
  'beng',
  'taml',
  'telu',
  'guru',
]);

const postcodeFormSchema = z.enum([
  'continental',
  'nl',
  'us',
  'uk',
  'jp',
  'cn',
  'kr',
  'none',
]);

const addressFormShapeSchema = z.enum([
  'standard',
  'inverted',
  'glued-suffix',
  'standalone-suffix',
  'inverted-with-article',
  'po-box',
  'postcode-anchored',
  'lieu-dit',
]);

const nationalIdSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pattern: z.string().min(1),
  // Sorted alphabetically — keep in sync with `NationalIdSpec.checksum` in
  // `./types.ts` and the dispatch switch in `national-ids/index.ts`.
  checksum: z
    .enum([
      'ar-cuil',
      'au-tfn',
      'be-nrn',
      'br-cnpj',
      'cz-rc',
      'de-steuer-id',
      'dk-cpr',
      'ean13',
      'es-dni',
      'es-nie',
      'fr-nir',
      'hk-hkid',
      'icao9303',
      'ie-mod23',
      'il-teudat-zehut',
      'it-codice-fiscale',
      'jp-mynumber',
      'kr-rrn',
      'luhn',
      'mod11-2-cn',
      'mod11-bsn',
      'mod11-cpf',
      'mx-curp',
      'my-mykad',
      'nz-ird',
      'pesel-mod10',
      'pt-nif',
      'ro-cnp',
      'ru-inn-12',
      'se-personnummer',
      'sg-nric',
      'tr-tckn',
      'verhoeff',
    ])
    .optional(),
  checksumLength: z.number().int().positive().optional(),
  replacement: z.string().min(1),
});

const addressConfigSchema = z.object({
  forms: z.array(addressFormShapeSchema).min(0),
  postcodeForm: postcodeFormSchema,
  postcodeRegex: z.string(),
  streetSuffixGlued: z.array(z.string()).optional(),
  streetKeywordsSpaced: z.array(z.string()).optional(),
  streetKeywordsInverted: z.array(z.string()).optional(),
  streetKeywordsStandard: z.array(z.string()).optional(),
  streetKeywordsFreeSuffix: z.array(z.string()).optional(),
  invertedPrepositions: z.array(z.string()).optional(),
  invertedArticles: z.array(z.string()).optional(),
  invertedPrepositionsLong: z.array(z.string()).optional(),
  poBoxKeywords: z.array(z.string()).optional(),
  floorKeywords: z.array(z.string()).optional(),
  countryNames: z.array(z.string()).optional(),
  ordinalNumberSuffixes: z.array(z.string()).optional(),
  ordinalAfterNumber: z.array(z.string()).optional(),
  directionalSuffixes: z.array(z.string()).optional(),
  houseNumberMarkers: z.array(z.string()).optional(),
  lieuDitKeywords: z.array(z.string()).optional(),
  countryPostcodePrefixes: z.array(z.string()).optional(),
  requireUppercase: z.boolean(),
});

const dateOfBirthConfigSchema = z.object({
  monthsLong: z.array(z.string().min(1)).optional(),
  monthsShort: z.array(z.string().min(1)).optional(),
  contextKeywords: z.array(z.string().min(1)).optional(),
  yearMarker: z.string().min(1).optional(),
  monthMarker: z.string().min(1).optional(),
  dayMarker: z.string().min(1).optional(),
}) satisfies z.ZodType<DateOfBirthConfig>;

const localeConfigSchema = z.object({
  locale: z.string().min(2),
  name: z.string().min(1),
  scripts: z.array(scriptSchema).min(1),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  phoneContextKeywords: z.array(z.string().min(1)),
  cvcContextKeywords: z.array(z.string().min(1)),
  address: addressConfigSchema,
  nationalIds: z.array(nationalIdSpecSchema),
  dateOfBirth: dateOfBirthConfigSchema.optional(),
  fixtureSeeds: z
    .object({
      addresses: z.array(z.string().min(1)).optional(),
      wrappers: z.array(z.string().min(1)).optional(),
      prose: z.array(z.string().min(1)).optional(),
      givenNames: z.array(z.string().min(1)).optional(),
      familyNames: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

// -----------------------------------------------------------------------------
// JSON imports — one per locale
//
// New locales are added here. The Zod parse below validates every entry at
// module load; a typo in JSON crashes startup with a precise error, not at
// detection time.
// -----------------------------------------------------------------------------

import arData from './data/ar.json' with { type: 'json' };
import bgData from './data/bg.json' with { type: 'json' };
import bnData from './data/bn.json' with { type: 'json' };
import caData from './data/ca.json' with { type: 'json' };
import csData from './data/cs.json' with { type: 'json' };
import daData from './data/da.json' with { type: 'json' };
import deData from './data/de.json' with { type: 'json' };
import elData from './data/el.json' with { type: 'json' };
import enData from './data/en.json' with { type: 'json' };
import esData from './data/es.json' with { type: 'json' };
import etData from './data/et.json' with { type: 'json' };
import faData from './data/fa.json' with { type: 'json' };
import fiData from './data/fi.json' with { type: 'json' };
import frData from './data/fr.json' with { type: 'json' };
import heData from './data/he.json' with { type: 'json' };
import hiData from './data/hi.json' with { type: 'json' };
import hrData from './data/hr.json' with { type: 'json' };
import huData from './data/hu.json' with { type: 'json' };
import idData from './data/id.json' with { type: 'json' };
import itData from './data/it.json' with { type: 'json' };
import jaData from './data/ja.json' with { type: 'json' };
import koData from './data/ko.json' with { type: 'json' };
import ltData from './data/lt.json' with { type: 'json' };
import lvData from './data/lv.json' with { type: 'json' };
import msData from './data/ms.json' with { type: 'json' };
import nbData from './data/nb.json' with { type: 'json' };
import nlData from './data/nl.json' with { type: 'json' };
import plData from './data/pl.json' with { type: 'json' };
import ptData from './data/pt.json' with { type: 'json' };
import roData from './data/ro.json' with { type: 'json' };
import ruData from './data/ru.json' with { type: 'json' };
import skData from './data/sk.json' with { type: 'json' };
import slData from './data/sl.json' with { type: 'json' };
import srData from './data/sr.json' with { type: 'json' };
import svData from './data/sv.json' with { type: 'json' };
import thData from './data/th.json' with { type: 'json' };
import tlData from './data/tl.json' with { type: 'json' };
import trData from './data/tr.json' with { type: 'json' };
import ukData from './data/uk.json' with { type: 'json' };
import urData from './data/ur.json' with { type: 'json' };
import viData from './data/vi.json' with { type: 'json' };
import zhHansData from './data/zh-Hans.json' with { type: 'json' };
import zhHantData from './data/zh-Hant.json' with { type: 'json' };

/** Every locale config the library knows about — 43 locales, 5 scripts. */
const RAW_LOCALES: unknown[] = [
  enData,
  deData,
  frData,
  itData,
  nlData,
  esData,
  ptData,
  svData,
  plData,
  ruData,
  ukData,
  jaData,
  zhHansData,
  zhHantData,
  koData,
  arData,
  heData,
  trData,
  elData,
  hiData,
  idData,
  viData,
  thData,
  csData,
  fiData,
  daData,
  nbData,
  huData,
  roData,
  skData,
  caData,
  faData,
  urData,
  bnData,
  msData,
  tlData,
  bgData,
  srData,
  hrData,
  slData,
  ltData,
  lvData,
  etData,
];

const LOCALES = new Map<string, LocaleConfig>();
for (const raw of RAW_LOCALES) {
  // `localeConfigSchema.parse(raw)` returns a type structurally identical
  // to `LocaleConfig` — the schema mirrors the interface field-for-field
  // and Zod's enum types resolve to the same string-literal unions. If a
  // contributor breaks parity (renames an enum value, drops a field),
  // TypeScript catches it here, not at first detection-time call.
  const parsed: LocaleConfig = localeConfigSchema.parse(raw);

  // National-ID regex sources arrive from JSON — treat each as untrusted
  // and gate every pattern before it is ever compiled at runtime. Two
  // checks per spec: (1) the source must compile (`new RegExp`), (2) it
  // must pass `safe-regex2` AST analysis (catches nested quantifiers
  // and ambiguous alternation — the shapes that exhaust
  // `execWithBudget`'s wall-clock budget).
  //
  // Fail-open: drop the offending spec rather than throw, so a single
  // bad entry can't take down module load for every consumer of every
  // locale. The warning names only `locale` + `id`; the pattern source
  // itself can leak ID-template structure and must never reach the log.
  parsed.nationalIds = parsed.nationalIds.filter((spec) => {
    try {
      // Compile only to validate syntax; the pattern is recompiled with
      // the `g` flag at use time in `national-ids/index.ts`.
      // eslint-disable-next-line no-new
      new RegExp(spec.pattern);
    } catch {
      console.warn(
        `[pii] dropping invalid nationalId regex in locale "${parsed.locale}": ${spec.id}`,
      );
      return false;
    }
    if (!safe(spec.pattern)) {
      console.warn(
        `[pii] dropping unsafe nationalId regex in locale "${parsed.locale}": ${spec.id}`,
      );
      return false;
    }
    return true;
  });

  LOCALES.set(parsed.locale, parsed);
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/** Lookup one locale config by code. Throws if the code is unknown. */
export function loadLocale(code: LocaleCode): LocaleConfig {
  const cfg = LOCALES.get(code);
  if (!cfg) {
    throw new Error(
      `[pii] unknown locale code: ${code}. Known: ${[...LOCALES.keys()].join(', ')}`,
    );
  }
  return cfg;
}

/** List every locale code the library has data for. */
export function listLocales(): LocaleCode[] {
  return [...LOCALES.keys()];
}

/**
 * Return true when `code` is a locale the registry has data for.
 *
 * Cheap O(1) lookup against the loaded `LOCALES` map. Useful for config
 * validators and admin-UI input checks that want to gate on "is this a
 * known locale" without throwing.
 */
export function isValidLocaleCode(code: string): boolean {
  return LOCALES.has(code);
}

/**
 * Resolve a locale selector into an explicit list of configs.
 *
 * `'*'` means "every locale". Otherwise an array of locale codes — each
 * resolved via `loadLocale` so unknown codes fail loudly.
 */
export function resolveLocales(selector: LocaleCode[] | '*'): LocaleConfig[] {
  if (selector === '*') return [...LOCALES.values()];
  return selector.map(loadLocale);
}

// -----------------------------------------------------------------------------
// Composition helpers — used by pattern composers to build runtime regex
// -----------------------------------------------------------------------------

/**
 * Build a regex alternation from one or more keyword lists.
 *
 * Behaviour:
 *   - All keywords from every locale are merged and de-duplicated.
 *   - Longest-first ordering — JavaScript leftmost-first alternation
 *     favors the keyword listed earlier, so multi-word keywords
 *     (`P.O. Box`) must precede their substrings (`Box`).
 *   - Each keyword is regex-escaped — keyword JSON files contain
 *     literals, not regex. The composer is the boundary that turns
 *     literals into regex source.
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
export type {
  AddressFormShape,
  DateOfBirthConfig,
  LocaleAddressConfig,
  LocaleConfig,
  NationalIdSpec,
  PostcodeForm,
  Script,
};
