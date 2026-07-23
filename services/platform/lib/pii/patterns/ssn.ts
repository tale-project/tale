/**
 * US SSN — data regex (strict NNN-NN-NNNN with Unicode-aware lookarounds)
 * plus the SSA validity gate: area 000, 666, and 900–999 are never
 * assigned, nor are group 00 and serial 0000. Filtering those removes
 * sequences like `000-12-3456` that cannot be real SSNs.
 */

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

export const buildSsnPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      const area = parseInt(m.slice(0, 3), 10);
      const group = parseInt(m.slice(4, 6), 10);
      const serial = parseInt(m.slice(7, 11), 10);
      if (area === 0 || area === 666 || area >= 900) return false;
      if (group === 0) return false;
      if (serial === 0) return false;
      return true;
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
