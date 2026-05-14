/**
 * Per-locale address-form composer.
 *
 * Each `AddressFormShape` maps to a function that takes a locale's
 * keyword arrays and emits the corresponding regex source string. The
 * top-level `composeAddressRegex` resolves every enabled locale, gathers
 * the per-form sources, joins them with `|`, appends the shared
 * `composeAddressTail`, and compiles the result with `giu` flags.
 *
 * Why decomposed into one composer per shape: shapes are the structural
 * vocabulary of postal addresses. A locale's JSON declares which shapes
 * apply; the composer knows how to weave the locale's tokens into the
 * shape's skeleton. Adding a new locale doesn't add a new shape — it
 * picks from the existing set.
 */

import { escapeRegExp } from '../../core/regex-safety';
import type { AddressFormShape, LocaleConfig } from '../../locales';
import { composeKeywordAlternation } from '../../locales';
import { HOUSE_NUM, NAME_PHRASE, NAME_TOKEN, UA, W } from './builders';

/**
 * Compose a regex alternation of literal keywords. Each input is escaped
 * (literals, not regex), longest-first ordered for leftmost-first match
 * fairness.
 */
function alternation(keywords: readonly string[] | undefined): string {
  if (!keywords || keywords.length === 0) return '(?!)';
  return [...new Set(keywords)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

// -----------------------------------------------------------------------------
// One composer per AddressFormShape — each returns 0+ regex source strings
// -----------------------------------------------------------------------------

/**
 * DE-style glued suffix (`Bahnhofstraße 12`, `Karl-Marx-Allee 50`).
 *
 * `${W}*` (zero-or-more) lets the suffix attach directly after a trailing
 * hyphen in the prefix (`Rudolf-Diesel-` + `Straße`). Suffix bounded by
 * Unicode-aware lookahead since JS `\b` is ASCII-only and fails after `ß`.
 */
function composeGluedSuffix(locale: LocaleConfig): string[] {
  const out: string[] = [];
  const glued = locale.address.streetSuffixGlued;
  if (glued && glued.length > 0) {
    const alt = glued
      .map(escapeRegExp)
      .sort((a, b) => b.length - a.length)
      .join('|');
    // Form 1: hyphen-prefix + glued suffix + number
    out.push(
      String.raw`\b(?:${W}+-){0,3}${W}*(?:${alt})${UA}\s+(?:Nr\.?\s*)?${HOUSE_NUM}`,
    );
  }
  // Form 3: spaced multi-word + spaced KW + number  (Schönhauser Allee 36).
  // Uses `streetKeywordsSpaced` (Title-Case keywords that appear AFTER a
  // separate word, not glued).
  const spaced = locale.address.streetKeywordsSpaced;
  if (spaced && spaced.length > 0) {
    const alt = alternation(spaced);
    // Form 2: hyphenated prefix + separate spaced KW
    out.push(
      String.raw`\b${W}+(?:-${W}+){1,4}(?:\s+${W}+){0,2}\s+(?:${alt})\s+${HOUSE_NUM}`,
    );
    // Form 3: single-word prefix + separate spaced KW
    out.push(String.raw`\b${W}+\s+(?:${alt})\s+${HOUSE_NUM}`);
  }
  return out;
}

/** DE-style standalone free-suffix (`Limmatquai 138`, `Theresienwiese 4`). */
function composeStandaloneSuffix(locale: LocaleConfig): string[] {
  const free = locale.address.streetKeywordsFreeSuffix;
  if (!free || free.length === 0) return [];
  const alt = free
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join('|');
  return [String.raw`\b(?:${W}+-){0,3}${W}*(?:${alt})${UA}\s+${HOUSE_NUM}`];
}

/**
 * DE-style inverted with article (`Unter den Linden 77`).
 *
 * Article (`den/der/dem/das/die`) is REQUIRED — otherwise common
 * prepositions like `In/Im` capture noun phrases such as `In Reeperbahn 1`.
 *
 * Also emits the no-article contracted-preposition form (`Im Tal 12`,
 * `Zur Eiche 3`) gated by a trailing-postcode lookahead — that gate
 * replaces the article requirement and stops `im Jahr 1990` matching.
 */
function composeInvertedWithArticle(locale: LocaleConfig): string[] {
  const out: string[] = [];
  const preps = locale.address.invertedPrepositions;
  const arts = locale.address.invertedArticles;
  if (preps && preps.length > 0 && arts && arts.length > 0) {
    const prepAlt = alternation(preps);
    const artAlt = alternation(arts);
    out.push(
      String.raw`\b(?:${prepAlt})\s+(?:${artAlt})\s+${NAME_TOKEN}\s+${HOUSE_NUM}`,
    );
  }
  const prepsLong = locale.address.invertedPrepositionsLong;
  if (prepsLong && prepsLong.length > 0) {
    const prepAlt = alternation(prepsLong);
    const pc = locale.address.postcodeRegex || String.raw`\d{4,5}`;
    out.push(
      String.raw`\b(?:${prepAlt})\s+${NAME_TOKEN}\s+${HOUSE_NUM}(?=[,\s]+${pc}\s+\p{L})`,
    );
  }
  return out;
}

/**
 * Inverted form (KEYWORD + NAME + NUMBER). FR `Rue de la Paix 5`,
 * IT `Via Nassa 5`, similar in CH-IT and Romandie. Title-Case requirement
 * lives in the validate post-filter, not the regex (case-folding under `/i`).
 *
 * For FR specifically, the building-number tail forbids single-letter unit
 * suffix `h` and disallows distance/time units immediately after (`km`,
 * `m`, `minutes`) — those are prose, not addresses. Other inverted-form
 * locales don't need that gate.
 */
function composeInverted(locale: LocaleConfig): string[] {
  const kws = locale.address.streetKeywordsInverted;
  if (!kws || kws.length === 0) return [];
  const alt = alternation(kws);
  // FR-specific trailing FP guard. Identified by the presence of FR ordinal
  // markers (bis/ter/quater) in the locale config.
  const hasFrTrailingGuard =
    (locale.address.ordinalAfterNumber?.length ?? 0) > 0;
  if (hasFrTrailingGuard) {
    return [
      String.raw`\b(?:${alt})\s+${NAME_PHRASE}\s+\d{1,5}(?:[A-GI-Za-gi-z])?\b(?!\s*(?:minutes?|min|mn|heures?|h\b|km|m\b|metres?|mètres?))`,
    ];
  }
  return [String.raw`\b(?:${alt})\s+${NAME_PHRASE}\s+${HOUSE_NUM}`];
}

/**
 * Standard form (NUMBER + KEYWORD + NAME). Includes EN/US street style
 * (123 Main Street + optional directional suffix), FR canonical
 * (5 [bis|ter] Rue de la Paix), and the keyword-first variants
 * (`Jalan ... No. 12`, `Calle ... No. 12`) that use a house-number marker.
 *
 * Three sub-shapes are emitted (when applicable):
 *
 *   - Number-first with optional `bis/ter/quater` (FR).
 *   - Number-first with English ordinal suffix + Title-Case name + KW +
 *     optional directional (EN/US).
 *   - Keyword-first with explicit house-number marker (ID/ES/PT).
 */
function composeStandard(locale: LocaleConfig): string[] {
  const out: string[] = [];
  const std = locale.address.streetKeywordsStandard;
  if (!std || std.length === 0) return out;
  const stdAlt = std
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join('|');

  // FR sub-shape: NUMBER + (bis|ter|quater)? + KW + NAME.
  const ord = locale.address.ordinalAfterNumber;
  if (ord && ord.length > 0) {
    const ordAlt = alternation(ord);
    out.push(
      String.raw`\b\d{1,5}(?:\s+(?:${ordAlt}))?\s+(?:${stdAlt})\s+${NAME_PHRASE}`,
    );
  }

  // EN sub-shape: NUMBER + ord-suffix? + (initial.|word){0,4} + KW + dir?
  const ordNum = locale.address.ordinalNumberSuffixes;
  const dir = locale.address.directionalSuffixes;
  if (ordNum && ordNum.length > 0) {
    const ordNumAlt = alternation(ordNum);
    const dirAlt = dir && dir.length > 0 ? alternation(dir) : '';
    const dirTail = dirAlt ? String.raw`(?:\s+(?:${dirAlt}))?` : '';
    out.push(
      String.raw`\b\d{1,5}(?:${ordNumAlt}|[A-Za-z])?\s+(?:[A-Z]\.\s+|${W}+\s+){0,4}(?:${stdAlt})${dirTail}`,
    );
  }

  // Keyword-first sub-shape: KW + NAME + no/nr/# + number  (ID/ES/PT/RU).
  // Only emitted when both `streetKeywordsInverted`-like entries also have
  // `houseNumberMarkers` declared.
  const markers = locale.address.houseNumberMarkers;
  const inv = locale.address.streetKeywordsInverted;
  if (markers && markers.length > 0 && inv && inv.length > 0) {
    const markerAlt = alternation(markers);
    const invAlt = alternation(inv);
    out.push(
      String.raw`\b(?:${invAlt})\s+${NAME_PHRASE}\s+(?:${markerAlt})\s*${HOUSE_NUM}`,
    );
  }

  return out;
}

/** Post-office-box form (`Postfach 1234`, `P.O. Box 1234`, `Case postale 5`). */
function composePoBox(locale: LocaleConfig): string[] {
  const kw = locale.address.poBoxKeywords;
  if (!kw || kw.length === 0) return [];
  const alt = alternation(kw);
  return [String.raw`\b(?:${alt})\s+\d[\d\s]{0,12}\d`];
}

/** FR `lieu-dit` form (no number required). */
function composeLieuDit(locale: LocaleConfig): string[] {
  const kw = locale.address.lieuDitKeywords;
  if (!kw || kw.length === 0) return [];
  const alt = alternation(kw);
  return [String.raw`\b(?:${alt})\s+${NAME_PHRASE}`];
}

/**
 * Postcode-anchored form for non-spaced scripts (JP / CN / KR / TH).
 *
 * Non-Latin scripts don't use spaces between words, so the standard
 * NUMBER+KW+NAME forms don't translate. Postcode-anchored detection
 * anchors on the locale's postcode shape (e.g. `〒NNN-NNNN` for JP,
 * `\d{6}` for CN, `\d{5}` for KR) and captures a run of CJK/Hangul/Thai
 * characters that follow it.
 *
 * Each locale's `address.postcodeRegex` provides the anchor; the script
 * subtags from `locale.scripts` drive which Unicode-script character class
 * captures the address body. Reasonably tight: the postcode is a strong
 * lead-in so prose containing the same digit count without an address
 * after it won't match.
 */
function composePostcodeAnchored(locale: LocaleConfig): string[] {
  const pc = locale.address.postcodeRegex;
  if (!pc) return [];
  // Build a character class from the locale's scripts.
  const scriptClasses: string[] = [];
  for (const s of locale.scripts) {
    if (s === 'jpan') {
      scriptClasses.push(
        '\\p{Script=Han}',
        '\\p{Script=Hiragana}',
        '\\p{Script=Katakana}',
      );
    } else if (s === 'hans' || s === 'hant') {
      scriptClasses.push('\\p{Script=Han}');
    } else if (s === 'kore') {
      scriptClasses.push('\\p{Script=Hangul}', '\\p{Script=Han}');
    } else if (s === 'thai') {
      scriptClasses.push('\\p{Script=Thai}');
    }
  }
  if (scriptClasses.length === 0) return [];
  // Script-letter class (no digits) — used as the discriminator so the
  // form never matches bare digit runs like SKUs or sequence numbers.
  const letterClass = `[${scriptClasses.join('')}]`;
  // Body class: script letters + digits + hyphen (number breakdowns like
  // `1-1-12` are common in JP/KR/CN addresses).
  const bodyClass = `[${scriptClasses.join('')}\\p{N}\\-]`;
  // Two anchoring shapes. Both REQUIRE at least one script letter in the
  // captured body (lookahead) so digit-only runs cannot match.
  return [
    // Postcode → script-letters body  (`〒100-0001 東京都千代田区…`)
    String.raw`〒?${pc}\s*(?=[^\p{L}]*${letterClass})${bodyClass}{4,80}`,
    // Script-letters body → postcode  (`東京都千代田区… 100-0001`)
    String.raw`(?=${bodyClass}*${letterClass})${bodyClass}{4,80}\s*〒?${pc}`,
  ];
}

const COMPOSERS: Record<AddressFormShape, (l: LocaleConfig) => string[]> = {
  'glued-suffix': composeGluedSuffix,
  'standalone-suffix': composeStandaloneSuffix,
  'inverted-with-article': composeInvertedWithArticle,
  inverted: composeInverted,
  standard: composeStandard,
  'po-box': composePoBox,
  'lieu-dit': composeLieuDit,
  // Postcode-anchored CJK forms are added in Phase 6.
  'postcode-anchored': composePostcodeAnchored,
};

/**
 * Compose all form regex sources for a single locale, in the order
 * `forms` is declared. Longest-first ordering within each composer
 * preserves match-evaluation fairness across the union.
 */
export function composeAddressFormsForLocale(locale: LocaleConfig): string[] {
  const out: string[] = [];
  for (const shape of locale.address.forms) {
    const composer = COMPOSERS[shape];
    out.push(...composer(locale));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Shared address tail — floor + postcode+city + country
// -----------------------------------------------------------------------------

/**
 * Compose the optional `floor + zipcity + country` tail from the union of
 * every enabled locale's keywords. Each piece is gated so an address can
 * appear standalone without postcode or country, but if it does carry
 * them, they're correctly bounded.
 */
export function composeAddressTail(locales: LocaleConfig[]): string {
  // Floor token alternation — union across locales.
  const floorAlt = composeKeywordAlternation(
    locales.map((l) => l.address.floorKeywords),
  );
  // Country names alternation — union across locales.
  const countryAlt = composeKeywordAlternation(
    locales.map((l) => l.address.countryNames),
  );

  // Per-postcode-form ZIPCITY shapes. Each locale contributes its own.
  const zipcityForms: string[] = [];
  const seenForms = new Set<string>();
  for (const l of locales) {
    const form = composeZipCityForLocale(l);
    if (form && !seenForms.has(form)) {
      zipcityForms.push(form);
      seenForms.add(form);
    }
  }

  // Floor component — one keyword with optional ordinal prefix and value
  // suffix. The pattern preserves the contract that JP/CN/KR postcode-
  // anchored forms ignore (they bake their own floor handling in Phase 6).
  const floorComponent = String.raw`(?:\d+(?:\s*\.|er|ère|e|ème|eme|nd|nde)?\s*)?(?<![\p{L}\p{M}])(?:${floorAlt})(?![\p{L}\p{M}])(?:\s+\d+[A-Za-z]?|\s+[A-Z][a-z]{0,2}\b)?`;
  const floorTail = String.raw`(?:[,\s]+${floorComponent}){0,5}`;

  const zipcityTail = zipcityForms.length
    ? String.raw`(?:[,\s]+(?:${zipcityForms.join('|')}))?`
    : '';
  const countryTail = String.raw`(?:[,\s]+(?:${countryAlt})(?![\p{L}\p{M}]))?`;

  return `${floorTail}${zipcityTail}${countryTail}`;
}

/** Build the locale's postcode + city tail per its `postcodeForm`. */
function composeZipCityForLocale(locale: LocaleConfig): string {
  const pc = locale.address.postcodeRegex;
  if (locale.address.postcodeForm === 'none' || !pc) return '';
  // City tail — Title-Case for Latin-script locales. CJK/Arabic/Hebrew
  // locales bypass this entirely (their postcode-anchored forms are added
  // in Phase 6).
  const cityTail = String.raw`[A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’]+(?:-[\p{L}\p{M}'’]+){0,4}`;
  switch (locale.address.postcodeForm) {
    case 'continental': {
      const prefixes = locale.address.countryPostcodePrefixes;
      const prefixAlt =
        prefixes && prefixes.length > 0
          ? `(?:${prefixes.map(escapeRegExp).join('|')}-)?`
          : '';
      return String.raw`${prefixAlt}${pc}\s+${cityTail}`;
    }
    case 'nl':
      // NL: 4 digits + 2-letter sector + city ("1012 LG Amsterdam").
      return String.raw`${pc}\s+${cityTail}`;
    case 'us':
      // US: City, State ZIP[+4]. Multi-word city gated by state code.
      return String.raw`[A-Z][\p{L}\p{M}]+(?:[,\s]+[A-Z][\p{L}\p{M}]+){0,2}[,\s]+[A-Z]{2}\s+${pc}`;
    case 'uk':
      // UK: City + alphanumeric postcode (London SW1A 2AA).
      return String.raw`[A-ZÀ-ÖØ-Þ][\p{L}\p{M}]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}\p{M}]+){0,2}\s+${pc}`;
    // jp/cn/kr postcode-anchored forms — handled by their own form composer
    // in Phase 6, not by the trailing zipcity tail.
    case 'jp':
    case 'cn':
    case 'kr':
      return '';
    default:
      return '';
  }
}

/**
 * Compiled-regex cache.
 *
 * Building the address regex for every `createScrubber` call would allocate
 * 30+ KB of intermediate strings and compile a complex regex on every
 * scrubber construction. Most callers reuse the same locale set across
 * many scrubbers (e.g. one scrubber per worker, but every worker uses the
 * same locale union). Cache by locale-code-set + their config identity so
 * repeated construction is free.
 *
 * The cache holds at most one entry per distinct locale combination —
 * because there are only ~50 locales total and combinations of `'*'` /
 * explicit subsets are bounded in practice, the cache stays small (no
 * `WeakRef` / LRU needed). Each cached `RegExp` is ~5 KB.
 */
const REGEX_CACHE = new Map<string, RegExp>();

/**
 * Final composition: per-locale forms joined with `|`, shared tail
 * appended, compiled with `giu`.
 *
 * Caches by sorted-locale-code key. Two `createScrubber` calls with the
 * same effective locale set share one compiled `RegExp`.
 */
export function composeAddressRegex(locales: LocaleConfig[]): RegExp {
  const cacheKey = locales
    .map((l) => l.locale)
    .sort()
    .join(',');
  const cached = REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const forms: string[] = [];
  for (const locale of locales) {
    forms.push(...composeAddressFormsForLocale(locale));
  }
  let regex: RegExp;
  if (forms.length === 0) {
    // No enabled locales contribute an address form. Use the never-match
    // regex so the detector returns no spans rather than crashing.
    regex = /(?!)/giu;
  } else {
    const tail = composeAddressTail(locales);
    regex = new RegExp(`(?:${forms.join('|')})${tail}`, 'giu');
  }

  REGEX_CACHE.set(cacheKey, regex);
  return regex;
}
