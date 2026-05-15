/**
 * Built-in pattern names — bundle-light entry point.
 *
 * This file deliberately imports no factories. The platform's admin UI and
 * Convex governance validator import `piiConfigSchema` from
 * `../schemas/config.ts`, which only needs the string list. Pulling the
 * full `BUILT_IN_PATTERNS` factory map (and through it `libphonenumber-js`
 * + the 43-locale JSON registry) just to validate a config payload
 * doubled the platform's governance-route bundle.
 *
 * `patterns/index.ts` re-exports these names so external consumers that
 * want both names + factories still have a single import surface.
 */

/**
 * The stable identifier under which each built-in pattern is configured.
 * Adding a new built-in: register the factory in `./index.ts` AND add the
 * name to `BUILT_IN_PATTERN_NAMES` below.
 */
export type BuiltInPatternName =
  | 'email'
  | 'phone'
  | 'creditCard'
  | 'cvc'
  | 'iban'
  | 'ipAddress'
  | 'macAddress'
  | 'jwt'
  | 'ssn'
  | 'dateOfBirth'
  | 'address'
  | 'nationalId';

/** Ordered list — drives the Zod enum and the admin UI default order. */
export const BUILT_IN_PATTERN_NAMES: readonly BuiltInPatternName[] = [
  'email',
  'phone',
  'creditCard',
  'cvc',
  'iban',
  'ipAddress',
  'macAddress',
  'jwt',
  'ssn',
  'dateOfBirth',
  'address',
  'nationalId',
] as const;
