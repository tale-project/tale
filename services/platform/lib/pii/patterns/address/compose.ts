/**
 * Postal-address composition — the native half of the `address` pattern.
 *
 * Every enabled locale declares which form shapes it uses; each shape maps
 * to one composer function that weaves the locale's keyword data into the
 * shape's skeleton and emits regex source strings. All per-locale forms
 * are joined with `|`, a shared optional tail (floor + postcode+city +
 * country, unioned across locales) is appended, and the result compiles
 * once with `giu` — cached by a content digest of the participating
 * locale data.
 *
 * The Title-Case guard is a `validate` post-filter, not a regex lookahead:
 * under the `i` flag every character class containing uppercase letters is
 * case-folded (ECMA-262), so an embedded `[A-Z]` assertion would be a
 * no-op. The validator runs after matching, where case applies normally,
 * and passes any match with zero Latin letters so CJK/Arabic/Thai spans
 * from mixed locale sets flow through untouched.
 */

import { escapeRegExp } from '../../core/regex-safety';
import type { PiiPattern } from '../../core/types';
import type { AddressFormShape, LocaleConfig } from '../../schema';
import { composeKeywordAlternation } from '../keywords';
import type { NativePatternBuilder } from '../native';
import { HOUSE_NUM, NAME_PHRASE, NAME_TOKEN, UA, W } from './primitives';

/** Escaped, longest-first alternation of literal keywords. */
function alternation(keywords: readonly string[] | undefined): string {
  if (!keywords || keywords.length === 0) return '(?!)';
  return [...new Set(keywords)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

// -----------------------------------------------------------------------------
// One composer per form shape — each returns zero or more regex sources
// -----------------------------------------------------------------------------

/**
 * Glued suffix (`Bahnhofstraße 12`, `Karl-Marx-Allee 50`): a name prefix
 * whose street suffix attaches without a space, plus the spaced-keyword
 * variants (`Schönhauser Allee 36`). `${W}*` lets the suffix follow a
 * trailing hyphen (`Rudolf-Diesel-` + `Straße`); the Unicode lookahead
 * bounds the suffix because `\b` fails after `ß`.
 */
function composeGluedSuffix(locale: LocaleConfig): string[] {
  const out: string[] = [];
  const glued = locale.address.streetSuffixGlued;
  if (glued && glued.length > 0) {
    const alt = glued
      .map(escapeRegExp)
      .sort((a, b) => b.length - a.length)
      .join('|');
    out.push(
      String.raw`\b(?:${W}+-){0,3}${W}*(?:${alt})${UA}\s+(?:Nr\.?\s*)?${HOUSE_NUM}`,
    );
  }
  const spaced = locale.address.streetKeywordsSpaced;
  if (spaced && spaced.length > 0) {
    const alt = alternation(spaced);
    out.push(
      String.raw`\b${W}+(?:-${W}+){1,4}(?:\s+${W}+){0,2}\s+(?:${alt})\s+${HOUSE_NUM}`,
    );
    out.push(String.raw`\b${W}+\s+(?:${alt})\s+${HOUSE_NUM}`);
  }
  return out;
}

/** Standalone free suffix (`Limmatquai 138`, `Theresienwiese 4`). */
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
 * Inverted with article (`Unter den Linden 77`). The article is REQUIRED
 * in the main form — without it, common prepositions capture ordinary
 * noun phrases. The contracted-preposition variant (`Im Tal 12`) trades
 * the article for a trailing-postcode lookahead, which is what stops
 * `im Jahr 1990` from matching.
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
 * Inverted form (KEYWORD + NAME + NUMBER): `Rue de la Paix 5`,
 * `Via Nassa 5`. Locales that declare `ordinalAfterNumber` (French) get a
 * trailing guard that refuses time/distance units after the number
 * (`5 rue … 10 minutes` is prose, not an address) and a restricted
 * letter-suffix that excludes bare `h` (hours).
 */
function composeInverted(locale: LocaleConfig): string[] {
  const kws = locale.address.streetKeywordsInverted;
  if (!kws || kws.length === 0) return [];
  const alt = alternation(kws);
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
 * Standard form (NUMBER + KEYWORD + NAME) in three sub-shapes, each gated
 * by the data that makes it meaningful:
 *  - number-first with locale ordinal (`5 bis Rue de la Paix`);
 *  - number-first with English ordinal + Title-Case words + keyword +
 *    optional directional (`1600 Pennsylvania Avenue NW`);
 *  - keyword-first with an explicit house-number marker
 *    (`Jalan Sudirman No. 12`).
 */
function composeStandard(locale: LocaleConfig): string[] {
  const out: string[] = [];
  const std = locale.address.streetKeywordsStandard;
  if (!std || std.length === 0) return out;
  const stdAlt = std
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join('|');

  const ord = locale.address.ordinalAfterNumber;
  if (ord && ord.length > 0) {
    const ordAlt = alternation(ord);
    out.push(
      String.raw`\b\d{1,5}(?:\s+(?:${ordAlt}))?\s+(?:${stdAlt})\s+${NAME_PHRASE}`,
    );
  }

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

/** PO box (`Postfach 1234`, `P.O. Box 1234`, `Case postale 5`). */
function composePoBox(locale: LocaleConfig): string[] {
  const kw = locale.address.poBoxKeywords;
  if (!kw || kw.length === 0) return [];
  const alt = alternation(kw);
  return [String.raw`\b(?:${alt})\s+\d[\d\s]{0,12}\d`];
}

/** Named place without a number (`Lieu-dit Le Moulin`). */
function composeLieuDit(locale: LocaleConfig): string[] {
  const kw = locale.address.lieuDitKeywords;
  if (!kw || kw.length === 0) return [];
  const alt = alternation(kw);
  return [String.raw`\b(?:${alt})\s+${NAME_PHRASE}`];
}

/**
 * Postcode-anchored form for non-spaced scripts (JP/CN/KR/TH): word-based
 * forms cannot apply without spaces, so the locale's postcode shape
 * (`〒NNN-NNNN`, six digits, …) anchors a run of script characters —
 * before or after. Both directions require at least one script LETTER in
 * the body via lookahead, so bare digit runs (SKUs, sequence numbers)
 * cannot match.
 */
function composePostcodeAnchored(locale: LocaleConfig): string[] {
  const pc = locale.address.postcodeRegex;
  if (!pc) return [];
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
  const letterClass = `[${scriptClasses.join('')}]`;
  // Body includes digits and hyphens — JP/KR/CN block-lot breakdowns like
  // `1-1-12` are part of the address.
  const bodyClass = `[${scriptClasses.join('')}\\p{N}\\-]`;
  return [
    String.raw`〒?${pc}\s*(?=[^\p{L}]*${letterClass})${bodyClass}{4,80}`,
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
  'postcode-anchored': composePostcodeAnchored,
};

/** All form sources for one locale, in its declared form order. */
function composeAddressFormsForLocale(locale: LocaleConfig): string[] {
  const out: string[] = [];
  for (const shape of locale.address.forms) {
    out.push(...COMPOSERS[shape](locale));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Shared optional tail — floor + postcode+city + country
// -----------------------------------------------------------------------------

/**
 * The optional tail every form may carry: up to five floor/unit
 * components, one postcode+city, one country name — each unioned across
 * the enabled locales and individually optional, so a bare street line
 * still matches while a full address is captured whole.
 */
function composeAddressTail(locales: ReadonlyArray<LocaleConfig>): string {
  const floorAlt = composeKeywordAlternation(
    locales.map((l) => l.address.floorKeywords),
  );
  const countryAlt = composeKeywordAlternation(
    locales.map((l) => l.address.countryNames),
  );

  const zipcityForms: string[] = [];
  const seenForms = new Set<string>();
  for (const l of locales) {
    const form = composeZipCityForLocale(l);
    if (form && !seenForms.has(form)) {
      zipcityForms.push(form);
      seenForms.add(form);
    }
  }

  // Floor component: optional ordinal prefix, the keyword under
  // Unicode-aware boundaries (\b is ASCII-only), optional short value
  // suffix (`3. Stock`, `Etage 2`, `Wohnung 12a`).
  const floorComponent = String.raw`(?:\d+(?:\s*\.|er|ère|e|ème|eme|nd|nde)?\s*)?(?<![\p{L}\p{M}])(?:${floorAlt})(?![\p{L}\p{M}])(?:\s+\d+[A-Za-z]?|\s+[A-Z][a-z]{0,2}\b)?`;
  const floorTail = String.raw`(?:[,\s]+${floorComponent}){0,5}`;

  const zipcityTail = zipcityForms.length
    ? String.raw`(?:[,\s]+(?:${zipcityForms.join('|')}))?`
    : '';
  const countryTail = String.raw`(?:[,\s]+(?:${countryAlt})(?![\p{L}\p{M}]))?`;

  return `${floorTail}${zipcityTail}${countryTail}`;
}

/**
 * The locale's postcode+city sub-tail, switched on its postcode geometry.
 * CJK forms return nothing here — their postcode anchoring is a primary
 * form, not a tail.
 */
function composeZipCityForLocale(locale: LocaleConfig): string {
  const pc = locale.address.postcodeRegex;
  if (locale.address.postcodeForm === 'none' || !pc) return '';
  // Title-Case city token. The leading class [A-ZÀ-ÖØ-Þ] covers Western
  // European uppercase including umlauts (Ä/Ö inside À–Ö, Ü inside Ø–Þ).
  const cityTail = String.raw`[A-ZÀ-ÖØ-Þ][\p{L}\p{M}’’]+(?:-[\p{L}\p{M}’’]+){0,4}`;
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
      return String.raw`${pc}\s+${cityTail}`;
    case 'us':
      return String.raw`[A-Z][\p{L}\p{M}]+(?:[,\s]+[A-Z][\p{L}\p{M}]+){0,2}[,\s]+[A-Z]{2}\s+${pc}`;
    case 'uk':
      return String.raw`[A-ZÀ-ÖØ-Þ][\p{L}\p{M}]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}\p{M}]+){0,2}\s+${pc}`;
    case 'jp':
    case 'cn':
    case 'kr':
      return '';
    default:
      return '';
  }
}

// Content-digest cache: keyed on each locale's address slice + scripts,
// sorted by code, because locale data is injected and codes alone do not
// identify the vocabulary. Composition runs once per distinct data set.
const ADDRESS_REGEX_CACHE = new Map<string, RegExp>();

export function composeAddressRegex(
  locales: ReadonlyArray<LocaleConfig>,
): RegExp {
  const cacheKey = JSON.stringify(
    locales
      .map((l) => ({
        locale: l.locale,
        scripts: l.scripts,
        address: l.address,
      }))
      .sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)),
  );
  const cached = ADDRESS_REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const forms: string[] = [];
  for (const locale of locales) {
    forms.push(...composeAddressFormsForLocale(locale));
  }
  let regex: RegExp;
  if (forms.length === 0) {
    regex = /(?!)/giu;
  } else {
    const tail = composeAddressTail(locales);
    regex = new RegExp(`(?:${forms.join('|')})${tail}`, 'giu');
  }

  ADDRESS_REGEX_CACHE.set(cacheKey, regex);
  return regex;
}

export const buildAddressPattern: NativePatternBuilder =
  (file) => (locales) => {
    if (locales.length === 0) return [];

    const regex = composeAddressRegex(locales);

    // Title-Case gate: on when ANY enabled locale requires it. Benign for
    // mixed sets — a match with no Latin letters (CJK/Arabic/Thai) passes
    // unconditionally.
    const requiresUppercase = locales.some((l) => l.address.requireUppercase);

    const pattern: PiiPattern = {
      name: file.name,
      regex,
      validate: requiresUppercase
        ? (m) => /[A-Z]/.test(m) || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(m)
        : undefined,
      replacement: file.replacement,
    };
    return [pattern];
  };
