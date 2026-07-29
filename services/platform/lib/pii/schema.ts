/**
 * Zod schemas for the pii library's system config files —
 * `configs/platform/system/pii/patterns/*.yml` and
 * `configs/platform/system/pii/locales/*.yml`.
 *
 * These describe the SHIPPED detection data (what patterns exist and what
 * vocabulary each locale contributes). Which of them an org turns on is a
 * separate, frozen contract: `piiConfigSchema` in `lib/shared/schemas/pii.ts`.
 *
 * Every schema is `.strict()` so a typo in a config file fails loudly at
 * load instead of silently degrading detection coverage. The inferred types
 * are the library's data vocabulary — there is no hand-maintained twin
 * interface to drift from.
 */

import { z } from 'zod/v4';

// -----------------------------------------------------------------------------
// Pattern definition files (`patterns/<name>.yml`)
// -----------------------------------------------------------------------------

/**
 * A regex data knob: source string plus flags. The engine appends the `g`
 * flag at compile time if the file omits it (the exec loop requires it).
 */
const patternRegexSchema = z
  .object({
    source: z.string().min(1).max(1000),
    flags: z
      .string()
      .regex(/^[gimsuy]*$/, 'flags must be a subset of gimsuy')
      .default(''),
  })
  .strict();

/**
 * One built-in pattern definition. Two shapes:
 *
 *  - Pure data (no `impl`): `regex` is required; the engine compiles it
 *    directly with the declared replacement and no post-filter.
 *  - `impl: native`: the detection/validation half is code in
 *    `lib/pii/patterns/<name>.ts`, registered in the native builder
 *    table. `regex` is then an optional data knob the native code consumes
 *    (wide-net shapes for Luhn/mod-97/segment validators); locale-composed
 *    patterns (phone, cvc, address, nationalId) take their vocabulary from
 *    the locale files instead.
 *
 * Shipped pattern regexes are code-tier trust (in-repo, reviewed, and
 * covered by the runtime exec budget), so unlike org-supplied custom
 * patterns they are gated by a compile check only — several built-ins use
 * lookbehinds that static safe-regex analysis cannot model.
 */
export const piiPatternFileSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().min(1),
    replacement: z.string().min(1).max(64),
    impl: z.literal('native').optional(),
    regex: patternRegexSchema.optional(),
  })
  .strict()
  .refine((file) => file.impl === 'native' || file.regex !== undefined, {
    message: 'a pattern without impl: native must declare a regex',
  });
export type PiiPatternFile = z.infer<typeof piiPatternFileSchema>;

// -----------------------------------------------------------------------------
// Locale dataset files (`locales/<locale>.yml`)
// -----------------------------------------------------------------------------

/** ISO 15924-ish script subtags — drive which address composer applies. */
export const scriptSchema = z.enum([
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
export type Script = z.infer<typeof scriptSchema>;

/** Postcode geometry — picks the postcode+city tail builder. */
export const postcodeFormSchema = z.enum([
  'continental',
  'nl',
  'us',
  'uk',
  'jp',
  'cn',
  'kr',
  'none',
]);
export type PostcodeForm = z.infer<typeof postcodeFormSchema>;

/** Address form shapes a locale declares — each maps to one composer. */
export const addressFormShapeSchema = z.enum([
  'standard',
  'inverted',
  'glued-suffix',
  'standalone-suffix',
  'inverted-with-article',
  'po-box',
  'postcode-anchored',
  'lieu-dit',
]);
export type AddressFormShape = z.infer<typeof addressFormShapeSchema>;

/**
 * Checksum algorithms with an implementation in
 * `lib/pii/patterns/national-ids/checksums.ts`. Extending this enum
 * without a matching implementation is caught by the dispatch switch's
 * exhaustiveness check.
 */
export const nationalIdChecksumSchema = z.enum([
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
]);
export type NationalIdChecksum = z.infer<typeof nationalIdChecksumSchema>;

/**
 * One national-ID spec. The regex source is data compiled at registry
 * build time; it passes a compile check AND safe-regex static analysis
 * there (dropped with a warning on failure, so one bad spec cannot take
 * the registry down).
 */
export const nationalIdSpecSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    pattern: z.string().min(1).max(500),
    checksum: nationalIdChecksumSchema.optional(),
    /** Required by the icao9303 checksum (total length incl. check digit). */
    checksumLength: z.number().int().positive().optional(),
    replacement: z.string().min(1).max(64),
  })
  .strict();
export type NationalIdSpec = z.infer<typeof nationalIdSpecSchema>;

const keywordListSchema = z.array(z.string().min(1));

/** The locale's address-detection configuration. */
export const localeAddressConfigSchema = z
  .object({
    forms: z.array(addressFormShapeSchema).min(1),
    postcodeForm: postcodeFormSchema,
    /** Regex source, no anchors/flags. Empty when `postcodeForm` is `none`. */
    postcodeRegex: z.string(),
    streetSuffixGlued: keywordListSchema.optional(),
    streetKeywordsSpaced: keywordListSchema.optional(),
    streetKeywordsInverted: keywordListSchema.optional(),
    streetKeywordsStandard: keywordListSchema.optional(),
    streetKeywordsFreeSuffix: keywordListSchema.optional(),
    invertedPrepositions: keywordListSchema.optional(),
    invertedArticles: keywordListSchema.optional(),
    invertedPrepositionsLong: keywordListSchema.optional(),
    poBoxKeywords: keywordListSchema.optional(),
    floorKeywords: keywordListSchema.optional(),
    countryNames: keywordListSchema.optional(),
    ordinalNumberSuffixes: keywordListSchema.optional(),
    ordinalAfterNumber: keywordListSchema.optional(),
    directionalSuffixes: keywordListSchema.optional(),
    houseNumberMarkers: keywordListSchema.optional(),
    lieuDitKeywords: keywordListSchema.optional(),
    countryPostcodePrefixes: keywordListSchema.optional(),
    /**
     * Title-Case validator hint — true for Latin-script locales, false
     * where casing does not exist (CJK, Arabic, Hebrew, Thai).
     */
    requireUppercase: z.boolean(),
  })
  .strict();
export type LocaleAddressConfig = z.infer<typeof localeAddressConfigSchema>;

/** Date-of-birth vocabulary for textual detection. All fields optional. */
export const dateOfBirthConfigSchema = z
  .object({
    monthsLong: keywordListSchema.optional(),
    monthsShort: keywordListSchema.optional(),
    contextKeywords: keywordListSchema.optional(),
    yearMarker: z.string().min(1).optional(),
    monthMarker: z.string().min(1).optional(),
    dayMarker: z.string().min(1).optional(),
  })
  .strict();
export type DateOfBirthConfig = z.infer<typeof dateOfBirthConfigSchema>;

/** One locale dataset file. */
export const localeConfigSchema = z
  .object({
    /** BCP 47 code (`en`, `de`, `zh-Hans`) — equals the file base name. */
    locale: z.string().min(2),
    /** Human-readable English name. */
    name: z.string().min(1),
    scripts: z.array(scriptSchema).min(1),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
    phoneContextKeywords: keywordListSchema.min(1),
    cvcContextKeywords: keywordListSchema.min(1),
    address: localeAddressConfigSchema,
    nationalIds: z.array(nationalIdSpecSchema),
    dateOfBirth: dateOfBirthConfigSchema.optional(),
  })
  .strict();
export type LocaleConfig = z.infer<typeof localeConfigSchema>;
