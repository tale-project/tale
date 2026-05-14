/**
 * Locale configuration schema.
 *
 * One JSON file per locale lives at `src/locales/data/<code>.json` and is
 * loaded by the locale registry. All language-dependent tokens — phone
 * context keywords, address keywords, country names, postcode forms,
 * national-ID specifications — are declared here so adding a new language
 * is a JSON edit, not a code change.
 *
 * Keep this type strict: a typo in a JSON file should fail Zod validation
 * at load time, not silently degrade detection coverage.
 */

/** Script subsystem indicators — drive which address-form composer applies. */
export type Script =
  | 'latn' // Latin
  | 'cyrl' // Cyrillic
  | 'grek' // Greek
  | 'arab' // Arabic
  | 'hebr' // Hebrew
  | 'jpan' // Japanese (mix of Han + Kana)
  | 'hans' // Han Simplified
  | 'hant' // Han Traditional
  | 'kore' // Korean (Hangul + Hanja)
  | 'thai' // Thai
  | 'deva' // Devanagari (Hindi, Marathi)
  | 'beng' // Bengali
  | 'taml' // Tamil
  | 'telu' // Telugu
  | 'guru'; // Gurmukhi (Punjabi)

/**
 * Postcode geometry. The detector composer reads this to pick which
 * `ZIPCITY_*` builder to use (and how the regex anchors the postcode).
 *
 *   - `continental`: 4-5 digit postcode + space + city (DE/FR/AT/CH/IT/ES/…)
 *   - `nl`:          4 digits + 2-letter sector + city ("1012 LG Amsterdam")
 *   - `us`:          City, State ZIP[+4]
 *   - `uk`:          City + alphanumeric postcode (SW1A 2AA)
 *   - `jp`:          〒NNN-NNNN — postcode-leading (postcode anchors form)
 *   - `cn`:          6 digits — postcode-leading
 *   - `kr`:          5 digits — postcode-leading
 *   - `none`:        locale has no canonical postcode (e.g. IE / HK Eircode is
 *                    alphanumeric but optional in practice). Falls back to
 *                    street + name + country-name anchoring.
 */
export type PostcodeForm =
  | 'continental'
  | 'nl'
  | 'us'
  | 'uk'
  | 'jp'
  | 'cn'
  | 'kr'
  | 'none';

/**
 * Address-form set the locale uses. Most Latin-script locales use
 * `standard` (NUMBER + KW + NAME, like FR) or `inverted` (NAME + KW + NUMBER,
 * like DE), and many support both. CJK locales use `postcode-anchored`
 * (postcode → admin → ward → street). Open as we add more locales.
 */
export type AddressFormShape =
  | 'standard' // 123 Main Street
  | 'inverted' // Hauptstraße 12
  | 'glued-suffix' // Bahnhofstraße 5  (suffix attaches to name without space)
  | 'standalone-suffix' // Limmatquai 138 (free-standing suffix)
  | 'inverted-with-article' // Unter den Linden 77
  | 'po-box' // Postfach 1234
  | 'postcode-anchored' // 〒100-0001 東京都… (CJK)
  | 'lieu-dit'; // Lieu-dit Le Moulin (no number)

/** One national-ID specification for a locale. */
export interface NationalIdSpec {
  /** Stable identifier — used by tests and the registry. */
  id: string;
  /** Human-readable name, English. */
  name: string;
  /** Regex source string (no flags). Compiled with `g`. */
  pattern: string;
  /**
   * Optional checksum algorithm. Maps to a function in
   * `patterns/national-ids/builders.ts`. If absent, the regex match is
   * accepted as-is — only safe for ID forms with extremely low
   * regex-only false-positive risk.
   *
   * Sorted alphabetically. When extending, keep the enum in
   * `localeConfigSchema` (and the dispatch switch in
   * `national-ids/index.ts`) in sync — TypeScript exhaustiveness checks
   * will surface any drift.
   */
  checksum?:
    | 'ar-cuil'
    | 'au-tfn'
    | 'be-nrn'
    | 'br-cnpj'
    | 'cz-rc'
    | 'de-steuer-id'
    | 'dk-cpr'
    | 'ean13'
    | 'es-dni'
    | 'es-nie'
    | 'fr-nir'
    | 'hk-hkid'
    | 'icao9303'
    | 'ie-mod23'
    | 'il-teudat-zehut'
    | 'it-codice-fiscale'
    | 'jp-mynumber'
    | 'kr-rrn'
    | 'luhn'
    | 'mod11-2-cn'
    | 'mod11-bsn'
    | 'mod11-cpf'
    | 'mx-curp'
    | 'my-mykad'
    | 'nz-ird'
    | 'pesel-mod10'
    | 'pt-nif'
    | 'ro-cnp'
    | 'ru-inn-12'
    | 'se-personnummer'
    | 'sg-nric'
    | 'tr-tckn'
    | 'verhoeff';
  /** Required by `icao9303` checksum (e.g. 9 for DE Personalausweis). */
  checksumLength?: number;
  /** Replacement token in mask mode. */
  replacement: string;
}

/** The locale's address-detection configuration. */
export interface LocaleAddressConfig {
  /** Which form shapes the locale uses (drives which composers fire). */
  forms: AddressFormShape[];
  /** Postcode geometry. */
  postcodeForm: PostcodeForm;
  /** Postcode regex source (no anchors, no flags). Empty when `postcodeForm` is `'none'`. */
  postcodeRegex: string;
  /** Street-suffix tokens that glue to the name without space (DE: `straße`, `allee`). */
  streetSuffixGlued?: string[];
  /** Street keywords that appear between name and number with space (DE: `Straße`, `Allee`). */
  streetKeywordsSpaced?: string[];
  /** Street keywords used before name (inverted: KW + NAME + NUMBER) — FR / IT. */
  streetKeywordsInverted?: string[];
  /** Street keywords used after number (standard: NUMBER + KW + NAME) — FR / EN. */
  streetKeywordsStandard?: string[];
  /** Standalone street suffixes that can end a name without a separate KW (DE: `quai`, `berg`). */
  streetKeywordsFreeSuffix?: string[];
  /** Prepositions for `prep + article + name + number` (DE: `Unter`, `An`). */
  invertedPrepositions?: string[];
  /** Articles required in the inverted form (DE: `den`, `der`). */
  invertedArticles?: string[];
  /** Contracted prepositions allowed without article, gated by postcode (DE: `Im`, `Zur`). */
  invertedPrepositionsLong?: string[];
  /** PO-box keywords (`Postfach`, `P.O. Box`, `Case postale`). */
  poBoxKeywords?: string[];
  /** Floor / unit keywords (long-first ordering matters; preserved as listed). */
  floorKeywords?: string[];
  /** Country names + 1-2-letter country codes that may appear in address tails. */
  countryNames?: string[];
  /**
   * Ordinal house-number suffixes: `st nd rd th` (EN), `er ère e ème eme nd nde` (FR).
   * Appended after the house number in the `standard` form.
   */
  ordinalNumberSuffixes?: string[];
  /**
   * Ordinal markers that follow the house number: `bis`, `ter`, `quater` (FR).
   * `5 bis Rue de la Paix`. Empty when the locale doesn't use them.
   */
  ordinalAfterNumber?: string[];
  /**
   * Directional suffixes after the street keyword: `NW NE SW SE N S E W` (US).
   * `1600 Pennsylvania Avenue NW`. Empty when the locale doesn't use them.
   */
  directionalSuffixes?: string[];
  /**
   * House-number markers in keyword-first forms: `no.`, `nr.`, `number`, `#` (ID),
   * `№` (RU).
   */
  houseNumberMarkers?: string[];
  /**
   * Locale-specific anchor for the `lieu-dit` (named-place) form (FR: `lieu-dit`).
   * Empty when the locale doesn't use this anchor.
   */
  lieuDitKeywords?: string[];
  /**
   * Country-prefix codes that may precede a postcode (CH-, D-, A-, FL-, …).
   * Used by the `bare-titlecase-name + country-prefix-postcode` form.
   */
  countryPostcodePrefixes?: string[];
  /**
   * Validator hint: real addresses contain at least one uppercase letter
   * (Title-Case requirement). True for Latin-script locales, false for
   * scripts where casing doesn't exist (CJK, Arabic, Hebrew, Thai).
   */
  requireUppercase: boolean;
}

/**
 * Date-of-birth detection vocabulary for the locale.
 *
 * Used by the textual-DOB composer (Wave 3) to recognize natural-language
 * dates of birth such as `geboren am 12. März 1980` or `1980年3月12日生`. The
 * detector composes the locale's month names, abbreviations, and contextual
 * keywords (`born on`, `geboren am`, `né le`) into a single regex per
 * locale; CJK locales add literal year/month/day characters via the
 * `*Marker` fields so the composer can anchor on `年`/`月`/`日`.
 *
 * Every field is optional. A locale that opts out (or simply has no DOB
 * configuration yet) contributes no DOB pattern. This keeps existing
 * locale JSON files valid without modification — only locales explicitly
 * declaring `dateOfBirth` participate in textual-DOB detection.
 */
export interface DateOfBirthConfig {
  /** Full month names in the locale's script (e.g. `März`, `mars`, `3月`). */
  monthsLong?: ReadonlyArray<string>;
  /** Common abbreviations, if idiomatic (e.g. `Jan.`, `Feb.`, `mär.`). */
  monthsShort?: ReadonlyArray<string>;
  /** Context keywords that precede a DOB (`born on`, `geboren am`, `né le`). */
  contextKeywords?: ReadonlyArray<string>;
  /** CJK literal year char if applicable (e.g. `年`). */
  yearMarker?: string;
  /** CJK literal month char (e.g. `月`). */
  monthMarker?: string;
  /** CJK literal day char (e.g. `日`). */
  dayMarker?: string;
}

/** Top-level locale configuration. */
export interface LocaleConfig {
  /** ISO 639-1 or BCP 47 code (`en`, `de`, `zh-Hans`). */
  locale: string;
  /** Human-readable English name. */
  name: string;
  /** ISO 15924 script subtags this locale uses. */
  scripts: Script[];
  /** ISO 3166-1 alpha-2 country codes that use this locale. */
  countries: string[];
  /**
   * Phone-number context keywords — `tel`, `téléphone`, `电话`, etc. The
   * phone detector joins these from every enabled locale into a single
   * keyword regex.
   */
  phoneContextKeywords: string[];
  /**
   * Card-verification-code context keywords — `CVC`, `CVV`, `CV2`,
   * `card security code` (EN), `cryptogramme visuel` (FR),
   * `Kartenprüfnummer` (DE), etc. The CVC detector composes its regex
   * from the union across every enabled locale.
   *
   * Common abbreviations (`CVC`, `CVV`, `CV2`) are language-independent
   * payment-industry terms but are still listed per-locale so adding a
   * locale doesn't silently drop them — listing them explicitly here
   * keeps the contract that *every* keyword the detector recognizes is
   * declared in a JSON file.
   */
  cvcContextKeywords: string[];
  /** Address-detection configuration. */
  address: LocaleAddressConfig;
  /** National-ID specs for the locale. Empty array if none. */
  nationalIds: NationalIdSpec[];
  /**
   * Optional date-of-birth detection vocabulary. Locales without this
   * field do not contribute to textual-DOB detection.
   */
  dateOfBirth?: DateOfBirthConfig;
  /**
   * Hand-curated test-data seeds in the locale's native script.
   *
   * Used by the fixture generator to produce diverse, language-appropriate
   * fixtures for locales where `datasets/<locale>/` is sparse or absent
   * (especially non-Latin scripts where Tatoeba prose isn't enough to
   * carry coverage). Every entry is a literal that the synthesizer can
   * combine with random house numbers / postcodes / city names.
   *
   * Optional — locales with rich dataset coverage (en/de/fr/it/nl/es)
   * don't need these because GeoNames + OSM already drive synthesis.
   */
  fixtureSeeds?: LocaleFixtureSeeds;
}

/**
 * Per-locale fixture seeds in the locale's native script.
 *
 * Each array contributes to the fixture generator's positive and negative
 * pools, replacing the English defaults for non-Latin locales where the
 * English wrappers would produce uniform, low-coverage tests.
 */
export interface LocaleFixtureSeeds {
  /**
   * Complete address strings (street + number + city + postcode) in the
   * locale's script. Each entry becomes a positive fixture, wrapped in a
   * locale-native carrier sentence (`wrappers` below).
   */
  addresses?: string[];
  /**
   * Carrier sentences with one `{}` placeholder where the PII gets
   * inserted. Each fixture uses one wrapper from this pool. Pure
   * locale-native prose — no English mixed in.
   */
  wrappers?: string[];
  /**
   * Pure prose negatives — sentences with no PII at all, in the locale's
   * native script. Used when `datasets/<locale>/prose.json` is missing
   * or undersized.
   */
  prose?: string[];
  /**
   * Person names in the locale's native script — given + family pairs.
   * Used to combine with the locale's email domains for plausible
   * synthetic emails.
   */
  givenNames?: string[];
  familyNames?: string[];
}
