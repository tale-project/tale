import { findPhoneNumbersInText } from 'libphonenumber-js';
import isCreditCard from 'validator/lib/isCreditCard';
import isIBAN from 'validator/lib/isIBAN';

export interface PiiMatchSpan {
  start: number;
  end: number;
  matchedText: string;
}

/**
 * A pattern is one of three shapes (exactly one of `regex` / `detect` set):
 *
 *  - `regex` only: classical pattern, runs through `execWithBudget`
 *  - `regex` + `validate`: regex finds candidate, post-filter accepts/rejects
 *    (used for IBAN mod-97 and credit card Luhn — eliminates whole classes
 *    of false positive)
 *  - `detect`: function-form for libraries with their own scanner
 *    (libphonenumber-js); skips `execWithBudget`
 */
export interface PiiPattern {
  name: string;
  replacement: string;
  regex?: RegExp;
  validate?: (matchedText: string) => boolean;
  detect?: (text: string) => PiiMatchSpan[];
}

/* -------------------------------------------------------------------------- */
/*  Address — multi-form alternation covering DE/FR/CH/EN + DOM-TOM           */
/* -------------------------------------------------------------------------- */

// Word token char class: Unicode letters + marks + digits + apostrophes
// (NO hyphen — putting `-` here with outer `+` causes catastrophic backtracking
// for inputs like "1 rue de-la-de-la-..." Hyphens go at the token-join level
// with a bounded `{0,4}` quantifier.)
const W = String.raw`[\p{L}\p{M}\p{N}_'’]`;
const NAME_TOKEN = String.raw`${W}+(?:-${W}+){0,4}`;
const NAME_PHRASE = String.raw`${NAME_TOKEN}(?:\s+${NAME_TOKEN}){0,5}`;

// Street keyword sets (each `\b`-anchored at use site via word chars in token)
const DE_SUFFIX_GLUED =
  'stra(?:ße|sse)|str\\.?|allee|platz|gasse|ring|markt|hof|weg|bahn|chaussee|stieg|blatt|reihe|damm|ufer|berg|wiese|anger|brücke|matt|vorstadt|wall';
const DE_KEYWORD_SPACED = String.raw`(?:Stra(?:ße|sse)|Str\.|Allee|Platz|Gasse|Ring|Markt|Hof|Weg|Wall)`;
const DE_FREE_SUFFIX =
  'quai|berg|markt|platz|hof|matt|brücke|vorstadt|chaussee';
const DE_INV_PREP = String.raw`(?:Unter|An|Am|Auf|Vor|Hinter|Bei|In|Im)`;
const DE_INV_ARTICLE = String.raw`(?:den|der|dem|das|die)`;

const FR_KEYWORDS_LOWER =
  '(?:rue|avenue|av\\.?|boulevard|bd\\.?|blvd\\.?|chemin|ch\\.?|place|pl\\.?|impasse|imp\\.?|allée|allee|route|rt\\.?|quai|cours|square|passage|faubourg|fbg\\.?|voie|promenade|rond-point)';
const FR_KEYWORDS_ICASE =
  '(?:[Rr]ue|[Aa]venue|av\\.?|[Bb]oulevard|bd\\.?|blvd\\.?|[Cc]hemin|ch\\.?|[Pp]lace|pl\\.?|[Ii]mpasse|imp\\.?|[Aa]ll[ée]e|[Rr]oute|rt\\.?|[Qq]uai|[Cc]ours|[Ss]quare|[Pp]assage|[Ff]aubourg|fbg\\.?|[Vv]oie|[Pp]romenade|[Rr]ond-point)';

const IT_KEYWORDS = '(?:Via|Viale|Piazza|Piazzale|Corso|Vicolo|Strada|Salita)';

const PO_KEYWORDS = String.raw`(?:Postfach|PF\.?|P\.\s*O\.\s*Box|PO\s+Box|Case\s+postale|Casella\s+postale)`;

const EN_STREET_KW =
  'street|st\\.|avenue|ave\\.?|road|rd\\.|drive|dr\\.|lane|ln\\.|boulevard|blvd\\.?|court|ct\\.|way|place|pl\\.|highway|hwy\\.?';

// Unicode-aware boundary helpers — JS `\b` is ASCII-only even under /u, so
// `\bétage\b` won't match because `é` isn't an ASCII word char. These
// lookarounds correctly bound on Unicode letter categories.
const UB = String.raw`(?<![\p{L}\p{M}])`;
const UA = String.raw`(?![\p{L}\p{M}])`;

// Floor / unit keywords. Long-first so JS leftmost-first alternation doesn't
// let `App` eat `Apartment` (and `Et` eat `Etage`). Unicode-bounded so accents
// don't break the boundary.
const FLOOR_TOKEN_KW = String.raw`${UB}(?:Rez-de-chaussée|Hochparterre|Seitenflügel|Quergebäude|Erdgeschoss|Souterrain|appartement|Mezzanin|Apartment|Résidence|Vorderhaus|Hinterhaus|Bâtiment|Wohnung|Escalier|Rés\.?|Bât\.?|Esc\.?|Aufgang|Eingang|Etage|étage|Suite|Ste\.?|Stock|appt\.?|Whg\.?|App\.?(?=\s|,|$)|Apt\.?|Unit|Flat|Floor|Haus|RDC|ét\.?|Fl\.?|DG|OG|UG|EG|WE|Zi\.?|Zimmer|links|rechts|c/o|z\.\s*Hd\.?)${UA}`;
// One floor-component (optional ordinal prefix + keyword + optional value),
// e.g. "3. OG", "4ème étage", "Whg. 12", "Apt 5B", "RDC", "Aufgang B".
// Trailing alpha-suffix is restricted to a single uppercase letter (with up
// to 2 trailing lowercase) so that "OG" doesn't greedily eat the next word
// in `3. OG Wohnung 12` — Wohnung must be a SEPARATE component on the next
// FLOOR_TAIL repetition, not absorbed as a suffix.
const FLOOR_COMPONENT = String.raw`(?:\d+(?:\s*\.|er|ère|e|ème|eme|nd|nde)?\s*)?${FLOOR_TOKEN_KW}(?:\s+\d+[A-Za-z]?|\s+[A-Z][a-z]{0,2}\b)?`;
const FLOOR_TAIL = String.raw`(?:[,\s]+${FLOOR_COMPONENT}){0,5}`;

// Continental (DE/FR/CH/AT/LI/LU): 4-5 digit zip, optional country prefix
// (CH-/D-/A-/L-/FL-), then capitalized city allowing hyphen-only compounds
// (so "Frankfurt-am-Main" / "Saint-Étienne-de-Tinée" pass but "Berlin Und" /
// "Paris Cordialement" / "Berlin Hauptbahnhof" cannot continue past the city).
const CITY_TAIL = String.raw`[\p{Lu}][\p{L}\p{M}]+(?:-[\p{L}\p{M}]+){0,4}`;
const ZIPCITY_CONTINENTAL = String.raw`(?:[A-Z]{1,2}-)?\d{4,5}\s+${CITY_TAIL}`;
// US: City State ZIP[+4] — multi-word city allowed only because state+ZIP gates it
const US_CITY_STATE_ZIP = String.raw`[A-Z][\p{L}\p{M}]+(?:\s+[A-Z][\p{L}\p{M}]+){0,2}\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?`;
// UK: City + postcode (London SW1A 2AA)
const UK_CITY_POSTCODE = String.raw`[\p{Lu}][\p{L}\p{M}]+(?:\s+[\p{Lu}][\p{L}\p{M}]+){0,2}\s+[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}`;
const ZIPCITY_TAIL = String.raw`(?:[,\s]+(?:${US_CITY_STATE_ZIP}|${UK_CITY_POSTCODE}|${ZIPCITY_CONTINENTAL}))?`;

// Country closed-set including DOM-TOM, DACH+ (Suisse/Svizzera), and 1-2 letter
// codes. `\b` boundary needed for short codes (CH/DE/FR/AT/UK/...).
const COUNTRY_TAIL = String.raw`(?:[,\s]+(?:Deutschland|Germany|France|United\s+Kingdom|United\s+States|USA?|Österreich|Austria|Schweiz|Suisse|Svizzera|Switzerland|Liechtenstein|Luxembourg|Luxemburg|L[ëe]tzebuerg|België|Belgium|Belgique|Nederland|Netherlands|Guadeloupe|Martinique|R[ée]union|Guyane|Nouvelle[-\s]Cal[ée]donie|Polyn[ée]sie\s+française|Mayotte|Saint[-\s]Martin|Saint[-\s]Barth[ée]lemy|UK|CH|DE|FR|AT|LI|LU|FL|NL|BE)\b)?`;

const ADDRESS_TAIL = `${FLOOR_TAIL}${ZIPCITY_TAIL}${COUNTRY_TAIL}`;

// 9 street-core forms ordered to bias longer / more-specific matches first.
// `\b` is used at start where the core begins with a word char.
const ADDRESS_FORMS = [
  // 1. DE glued suffix (with optional hyphenated prefix):
  //      Musterstraße 12  /  Bahnhofstr. 5a  /  Karl-Marx-Allee 50
  //    `${W}*` (zero-or-more) lets the suffix attach directly after a trailing
  //    hyphen in the prefix (e.g. `Rudolf-Diesel-` + `Straße`). Suffix is
  //    bounded by Unicode-aware lookahead since JS `\b` is ASCII-only and
  //    fails after `ß`/`é`. Greedy + backtracking lands the suffix at word end.
  String.raw`\b(?:${W}+-){0,3}${W}*(?:${DE_SUFFIX_GLUED})${UA}\s+(?:Nr\.?\s*)?\d{1,5}[A-Za-z]?`,
  // 2. DE hyphenated prefix + separate spaced keyword:
  //      Bad-Cannstatter Str. 9  (rare — most hyphenated names glue suffix)
  String.raw`\b${W}+(?:-${W}+){1,4}(?:\s+${W}+){0,2}\s+${DE_KEYWORD_SPACED}\s+\d{1,5}[A-Za-z]?`,
  // 3. DE spaced multi-word: Schönhauser Allee 36  /  Sendlinger Str. 8
  String.raw`\b${W}+\s+${DE_KEYWORD_SPACED}\s+\d{1,5}[A-Za-z]?`,
  // 4. DE free-suffix standalone (with optional hyphenated prefix):
  //      Limmatquai 138  /  Theresienwiese 4
  String.raw`\b(?:${W}+-){0,3}${W}*(?:${DE_FREE_SUFFIX})${UA}\s+\d{1,5}[A-Za-z]?`,
  // 5. DE inverted: prep + article + name + number  (Unter den Linden 77).
  //    Article (den/der/dem/das/die) is REQUIRED, not optional, otherwise
  //    common prepositions like `In/Im` capture noun phrases such as
  //    `In Reeperbahn 1` (where the bare name is itself a valid free-suffix
  //    address) or `im Jahr 1990` (year prose).
  String.raw`\b${DE_INV_PREP}\s+${DE_INV_ARTICLE}\s+${NAME_TOKEN}\s+\d{1,5}[A-Za-z]?`,
  // 6. FR/Romandie inverted (KEYWORD + NAME + NUMBER) — must include uppercase
  //    proper noun via lookahead to avoid prose like "rue est calme à 22h".
  //    Building number excludes single letter `h` and forbids unit suffixes.
  String.raw`\b${FR_KEYWORDS_ICASE}\s+(?=[\p{L}\p{M}\d'’\- ]{1,40}?\p{Lu})${NAME_PHRASE}\s+\d{1,5}(?:[A-GI-Za-gi-z])?\b(?!\s*(?:minutes?|min|mn|heures?|h\b|km|m\b|metres?|mètres?))`,
  // 7. FR standard (NUMBER + KEYWORD + NAME) with bis/ter/quater
  String.raw`\b\d{1,5}(?:\s+(?:bis|ter|quater))?\s+${FR_KEYWORDS_LOWER}\s+${NAME_PHRASE}`,
  // 8. EN/UK style:  123 Main Street  /  10 Downing Street
  //    Two-letter abbreviations forced to require `.` to prevent `ist`/`wird`
  //    being parsed as `i-st`/`wi-rd` inside German prose.
  String.raw`\b\d{1,5}[A-Za-z]?\s+(?:${W}+\s+){0,4}(?:${EN_STREET_KW})`,
  // 9. ID/ES keyword-first with explicit no/nr marker (existing behavior)
  String.raw`\b(?:street|jalan|jl\.?|calle|avenida|carrera|via)\s+${NAME_PHRASE}\s+(?:no\.?|nr\.?|number|#)\s*\d{1,5}[A-Za-z]?`,
  // 10. Postfach (no street keyword)
  String.raw`\b${PO_KEYWORDS}\s+\d[\d\s]{0,12}\d`,
  // 11. CH-IT (Ticino) Via Nassa 5  /  Piazza della Riforma 1
  String.raw`\b${IT_KEYWORDS}\s+${NAME_PHRASE}\s+\d{1,5}[A-Za-z]?`,
  // 12. FR lieu-dit (no number required)
  String.raw`\b[Ll]ieu-dit\s+${NAME_PHRASE}`,
];

const ADDRESS_REGEX = new RegExp(
  `(?:${ADDRESS_FORMS.join('|')})${ADDRESS_TAIL}`,
  'giu',
);

/* -------------------------------------------------------------------------- */
/*  Phone — hybrid: libphonenumber-js + context-anchored regex                */
/* -------------------------------------------------------------------------- */

// Context-anchor: keyword (long-first to win leftmost-first alternation),
// Unicode-aware boundary (`\p{L}\p{M}` so NFD decomposition of `é` doesn't
// leak through), capture group is the number itself (keyword stays unmasked).
const PHONE_CONTEXT_RE =
  /(?<![\p{L}\p{M}])(?:telefonnummer|telefono|telefoni|telefon|téléphone|telephone|téléph?|festnetz|mobilnummer|rufnummer|durchwahl|anschluss|cellphone|mobile|mobil|natel|handy|portable|numéro|phone|call|gsm|tél\.?|tel\.?|fixe|fon|ruf|cell|n°)(?![\p{L}\p{M}])[\s:.\-/]*(\+?[\d(][\d\s\-()./]{6,24})/giu;

// Performance defenses (R2-9): libphone's PhoneNumberMatcher re-validates every
// digit cluster, so phone-saturated inputs can spike to ~180ms p99. Cap inputs
// and bail early on cluster overload; rely on context regex (which is < 0.5ms)
// as a fallback in those cases.
const PHONE_LIBPHONE_MAX_LEN = 32_000;
const PHONE_LIBPHONE_MAX_CLUSTERS = 200;
const PHONE_LIBPHONE_BUDGET_MS = 40;
const PHONE_CLUSTER_RE = /[\d][\d\s\-().]{8,}/g;
const PHONE_DIGIT_RE = /\d/g;

function detectPhone(text: string): PiiMatchSpan[] {
  const out: PiiMatchSpan[] = [];

  // libphonenumber-js path (international `+`-prefixed numbers)
  const tooLarge = text.length > PHONE_LIBPHONE_MAX_LEN;
  const clusterCount = text.match(PHONE_CLUSTER_RE)?.length ?? 0;
  const tooMany = clusterCount > PHONE_LIBPHONE_MAX_CLUSTERS;

  if (!tooLarge && !tooMany) {
    const start = Date.now();
    try {
      for (const n of findPhoneNumbersInText(text)) {
        out.push({
          start: n.startsAt,
          end: n.endsAt,
          matchedText: text.slice(n.startsAt, n.endsAt),
        });
        if (Date.now() - start > PHONE_LIBPHONE_BUDGET_MS) {
          console.debug(
            '[pii_phone] libphonenumber-js exceeded budget, partial result',
          );
          break;
        }
      }
    } catch (err) {
      console.debug(
        `[pii_phone] libphonenumber-js threw: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  // Context-anchored local-number path (Tel:/Telefon:/Tél:/Natel:/...)
  PHONE_CONTEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_CONTEXT_RE.exec(text)) !== null) {
    const numberStr = m[1];
    if (!numberStr) continue;
    const numberStart = m.index + m[0].lastIndexOf(numberStr);
    const digits = numberStr.match(PHONE_DIGIT_RE)?.length ?? 0;
    if (digits >= 7) {
      out.push({
        start: numberStart,
        end: numberStart + numberStr.length,
        matchedText: numberStr,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Built-in patterns                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Order matters: `BUILT_IN_PII_PATTERNS` order is the implicit tie-breaker for
 * the dedup pass when two patterns match the exact same span (rare). Earlier
 * entries win. Tests in pii_patterns.test.ts pin this contract.
 */
export const BUILT_IN_PII_PATTERNS: PiiPattern[] = [
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL]',
  },
  {
    name: 'phone',
    detect: detectPhone,
    replacement: '[PHONE]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]',
  },
  {
    name: 'creditCard',
    // Anchor with negative lookarounds to prevent 19-digit-card truncation
    // and stray-digit eats. Last character must be a digit (not separator),
    // otherwise `(?:\d[ -]?){N}` would greedily consume a trailing space and
    // shift the splice into the next match. Validate via Luhn.
    regex: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,
    validate: (m) => {
      try {
        return isCreditCard(m.replace(/[\s-]/g, ''));
      } catch {
        return false;
      }
    },
    replacement: '[CREDIT_CARD]',
  },
  {
    // Context-anchored: bare 3-4 digit numbers are intentionally NOT detected
    // (would false-positive on ages, room numbers, error codes). Microsoft
    // Presidio, AWS Comprehend, and Cloudflare WAF all skip CVV detection
    // for the same reason. This catches the labeled cases only.
    name: 'cvc',
    regex:
      /\b(?:cvc|cvv|cv2|card[\s-]?security[\s-]?code)\b(?:\s+is)?\s*[:=]?\s*\d{3,4}\b/gi,
    replacement: '[CVC]',
  },
  {
    name: 'ipAddress',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP_ADDRESS]',
  },
  {
    name: 'dateOfBirth',
    regex: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g,
    replacement: '[DATE_OF_BIRTH]',
  },
  {
    name: 'address',
    regex: ADDRESS_REGEX,
    replacement: '[ADDRESS]',
  },
  {
    name: 'iban',
    // Min 16 chars (BE IBAN is shortest in DACH/EU at 16); max 34 (Malta).
    // Tail is optional so 16-char (4-group) IBANs like BE/NL match cleanly;
    // longer IBANs (DE 22, FR 27, UK 22, CH 21) fall into the rep-or-tail.
    regex:
      /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}(?:[\s-]?[\dA-Z]{4}){2,6}(?:[\s-]?[\dA-Z]{1,4})?\b/g,
    // validator.isIBAN strips whitespace/hyphens and uppercases internally,
    // so passing the raw match is equivalent to pre-stripping.
    validate: (m) => {
      try {
        return isIBAN(m);
      } catch {
        return false;
      }
    },
    replacement: '[IBAN]',
  },
  {
    name: 'germanId',
    regex: /\b[CFGHJKLMNPRTVWXYZ][CFGHJKLMNPRTVWXYZ\d]{8}\b/g,
    replacement: '[GERMAN_ID]',
  },
];

/**
 * Return only the built-in patterns whose names appear in the enabled list.
 */
export function getEnabledPatterns(enabledNames: string[]): PiiPattern[] {
  const nameSet = new Set(enabledNames);
  return BUILT_IN_PII_PATTERNS.filter((p) => nameSet.has(p.name));
}
