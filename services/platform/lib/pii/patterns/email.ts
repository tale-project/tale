/**
 * Email — data regex plus the RFC 5321 domain length gate.
 *
 * The regex lives in the pattern file and bounds the local part itself at
 * 64 characters, a bound that also keeps its scan linear; this code half
 * only rejects candidates whose domain exceeds 255 — a length the regex's
 * open domain run does not express. Locale-independent: the factory
 * ignores its argument.
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
    validate: (m) => m.length - m.indexOf('@') <= 255,
    replacement: file.replacement,
  };
  return () => [pattern];
};
