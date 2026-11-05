/**
 * IBAN — data regex plus the ISO 13616 mod-97 gate (`validator`'s
 * `isIBAN`). The structural regex lives in the pattern file; the validator
 * eliminates order-number lookalikes that merely match the shape.
 *
 * Imported through the package's entry, not its `lib/isIBAN` file: that
 * file is CommonJS with a named export beside its default, so Node hands an
 * ESM import its whole `exports` object, and every IBAN validated false
 * under the backend's runtime — the organization's PII policy never masked
 * one — while a bundler's interop handed the tests the function.
 */

import validator from 'validator';

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

export const buildIbanPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      try {
        return validator.isIBAN(m);
      } catch (err) {
        console.warn(
          `[pii] IBAN validation error: ${err instanceof Error ? err.name : 'unknown'}`,
        );
        return false;
      }
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
