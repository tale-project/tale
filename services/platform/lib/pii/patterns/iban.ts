/**
 * IBAN — data regex plus the ISO 13616 mod-97 gate (`validator`'s
 * `isIBAN`). The structural regex lives in the pattern file; the validator
 * eliminates order-number lookalikes that merely match the shape.
 */

import isIBAN from 'validator/lib/isIBAN';

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
        return isIBAN(m);
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
