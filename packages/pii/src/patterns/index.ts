/**
 * Built-in pattern registry — every factory the library ships out of the box.
 *
 * Each entry maps a stable pattern name (used in `ScrubberOptions.patterns`
 * and in the Zod-validated runtime config) to its `PiiPatternFactory`. The
 * factory shape is the contract that lets locale-aware patterns
 * (CVC / phone / address / national-id) compose their regex from the
 * enabled locale set while universal patterns (email / SSN / credit card /
 * IBAN / IP / date-of-birth) ignore it.
 *
 * The map is exported as a frozen object so external code can introspect
 * which built-ins exist (e.g. the admin UI lists toggleable patterns) and
 * the `PatternRegistry` can clone the entries when extension calls layer on
 * overrides or additions.
 */

import type { PiiPatternFactory } from '../core/types';
import { addressFactory } from './address';
import { creditCardFactory } from './credit-card';
import { cvcFactory } from './cvc';
import { dateOfBirthFactory } from './date-of-birth';
import { emailFactory } from './email';
import { ibanFactory } from './iban';
import { ipAddressFactory } from './ip-address';
import { nationalIdFactory } from './national-ids';
import { phoneFactory } from './phone';
import { ssnFactory } from './ssn';

/**
 * The stable identifier under which each built-in pattern is configured.
 * Adding a new built-in: register the factory below and add the name to
 * the `BUILT_IN_PATTERN_NAMES` array — the Zod config schema picks it up
 * automatically via `BUILT_IN_PATTERN_NAMES`.
 */
export type BuiltInPatternName =
  | 'email'
  | 'phone'
  | 'creditCard'
  | 'cvc'
  | 'iban'
  | 'ipAddress'
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
  'ssn',
  'dateOfBirth',
  'address',
  'nationalId',
] as const;

/**
 * `name -> factory` map. Frozen so no consumer can mutate the global
 * registry — extensions go through `PatternRegistry.override` / `.add`
 * instead.
 */
export const BUILT_IN_PATTERNS: Readonly<
  Record<BuiltInPatternName, PiiPatternFactory>
> = Object.freeze({
  email: emailFactory,
  phone: phoneFactory,
  creditCard: creditCardFactory,
  cvc: cvcFactory,
  iban: ibanFactory,
  ipAddress: ipAddressFactory,
  ssn: ssnFactory,
  dateOfBirth: dateOfBirthFactory,
  address: addressFactory,
  nationalId: nationalIdFactory,
});

/**
 * Return the factories for the named built-ins, in registration order.
 * Unknown names are logged and skipped — the scrubber stays operational
 * even when a stale admin config references a removed built-in.
 */
const BUILT_IN_NAME_SET: ReadonlySet<string> = new Set(BUILT_IN_PATTERN_NAMES);

export function getEnabledPatterns(
  enabledNames: ReadonlyArray<string>,
): PiiPatternFactory[] {
  const enabled = new Set(enabledNames);
  const factories: PiiPatternFactory[] = [];
  for (const name of BUILT_IN_PATTERN_NAMES) {
    if (enabled.has(name)) factories.push(BUILT_IN_PATTERNS[name]);
  }
  for (const requested of enabled) {
    if (!BUILT_IN_NAME_SET.has(requested)) {
      console.debug(
        `[pii] enabledPatterns references unknown built-in "${requested}"; skipping`,
      );
    }
  }
  return factories;
}
