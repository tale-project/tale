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
import { jwtFactory } from './jwt';
import { macAddressFactory } from './mac-address';
// `./names` exposes the bundle-light name list — schema-only consumers
// (admin UI, config validator) import from there directly so they don't
// drag in libphonenumber-js or the locale registry through this barrel.
import type { BuiltInPatternName } from './names';
import { nationalIdFactory } from './national-ids';
import { phoneFactory } from './phone';
import { ssnFactory } from './ssn';

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
  macAddress: macAddressFactory,
  jwt: jwtFactory,
  ssn: ssnFactory,
  dateOfBirth: dateOfBirthFactory,
  address: addressFactory,
  nationalId: nationalIdFactory,
});
