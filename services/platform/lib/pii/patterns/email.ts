/**
 * Email — data regex plus the RFC 5321 length gate.
 *
 * The wide-net regex lives in the pattern file; this code half only
 * rejects candidates whose local part exceeds 64 characters or whose
 * domain exceeds 255 — lengths a character-class regex cannot express
 * without exploding. Locale-independent: the factory ignores its argument.
 */

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

export const buildEmailPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      const atIdx = m.indexOf('@');
      if (atIdx > 64) return false;
      if (m.length - atIdx > 255) return false;
      return true;
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
