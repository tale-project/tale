/**
 * The native builder table — the one place that pairs an `impl: native`
 * pattern definition file with its code half.
 *
 * The cases and why they need code:
 *  - email       — RFC 5321 length gate on top of the data regex
 *  - phone       — libphonenumber scanner + locale-keyword context regex
 *  - creditCard  — Luhn (mod-10) post-filter
 *  - cvc         — regex composed from locale CVC keyword vocabulary
 *  - iban        — ISO 13616 mod-97 post-filter
 *  - ipAddress   — range/compression validation, %zone handling
 *  - jwt         — Base64URL segment decode + JSON-object check
 *  - ssn         — SSA area/group/serial validity gate
 *  - dateOfBirth — plausibility validators + locale textual composition
 *  - address     — per-locale form composition from address vocabulary
 *  - nationalId  — per-spec patterns wired to named checksum algorithms
 *
 * A pattern file naming an unregistered native impl is logged and skipped
 * by the registry (never a throw); the pii test suite pins that every
 * shipped definition materializes.
 */

import type { PiiPatternFactory } from '../core/types';
import type { PiiPatternFile } from '../schema';
import { buildAddressPattern } from './address/compose';
import { buildCreditCardPattern } from './credit-card';
import { buildCvcPattern } from './cvc';
import { buildDateOfBirthPattern } from './date-of-birth';
import { buildEmailPattern } from './email';
import { buildIbanPattern } from './iban';
import { buildIpAddressPattern } from './ip-address';
import { buildJwtPattern } from './jwt';
import { buildNationalIdPattern } from './national-ids/factory';
import { buildPhonePattern } from './phone';
import { buildSsnPattern } from './ssn';

/** Code half of an `impl: native` pattern: definition file in, factory out. */
export type NativePatternBuilder = (file: PiiPatternFile) => PiiPatternFactory;

/**
 * Compile a pattern file's regex knob, forcing the `g` flag the exec loop
 * requires. Returns null (with a warning) when the knob is missing or does
 * not compile, so a broken definition degrades to "pattern contributes
 * nothing" instead of taking the registry down.
 */
export function compileRegexKnob(file: PiiPatternFile): RegExp | null {
  if (!file.regex) {
    console.warn(`[pii] pattern "${file.name}" has no regex knob; skipping`);
    return null;
  }
  const flags = file.regex.flags.includes('g')
    ? file.regex.flags
    : `${file.regex.flags}g`;
  try {
    return new RegExp(file.regex.source, flags);
  } catch (err) {
    console.warn(
      `[pii] pattern "${file.name}" regex failed to compile: ${err instanceof Error ? err.name : 'unknown'}`,
    );
    return null;
  }
}

export const NATIVE_PATTERN_BUILDERS: Readonly<
  Record<string, NativePatternBuilder>
> = Object.freeze({
  email: buildEmailPattern,
  phone: buildPhonePattern,
  creditCard: buildCreditCardPattern,
  cvc: buildCvcPattern,
  iban: buildIbanPattern,
  ipAddress: buildIpAddressPattern,
  jwt: buildJwtPattern,
  ssn: buildSsnPattern,
  dateOfBirth: buildDateOfBirthPattern,
  address: buildAddressPattern,
  nationalId: buildNationalIdPattern,
});
