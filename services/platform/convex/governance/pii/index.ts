import { blocked, modified, pass, type FilterOutcome } from '../filter_outcome';
import { detectPii } from './pii_detector';
import { maskPii } from './pii_masker';
import {
  BUILT_IN_PII_PATTERNS,
  getEnabledPatterns,
  type PiiPattern,
} from './pii_patterns';

export interface PiiConfig {
  enabled: boolean;
  mode: 'mask' | 'block';
  enabledPatterns: string[];
  customPatterns?: Array<{
    name: string;
    regex: string;
    replacement: string;
  }>;
}

function buildPatterns(config: PiiConfig): PiiPattern[] {
  const builtIn = getEnabledPatterns(config.enabledPatterns);
  const custom: PiiPattern[] = (config.customPatterns ?? []).map((cp) => ({
    name: cp.name,
    regex: new RegExp(cp.regex, 'g'),
    replacement: cp.replacement,
  }));
  return [...builtIn, ...custom];
}

/**
 * Pure PII scrubber. Returns a FilterOutcome (never throws). The `sanitize.ts`
 * dispatcher converts `blocked` into a ConvexError with legacy substring so
 * old clients continue to match via `.includes('Message blocked: PII')`.
 *
 * Browser-safe: pure regex + string ops, no Node-only APIs.
 */
export function scrubPii(text: string, config: PiiConfig): FilterOutcome {
  if (!config.enabled) return pass();

  const patterns = buildPatterns(config);
  const matches = detectPii(text, patterns);
  if (matches.length === 0) return pass();

  const detectedTypes = [...new Set(matches.map((m) => m.patternName))];

  if (config.mode === 'block') {
    return blocked(detectedTypes, matches.length);
  }

  const maskedText = maskPii(text, matches);
  return modified(maskedText, detectedTypes, matches.length);
}

export { BUILT_IN_PII_PATTERNS } from './pii_patterns';
export { detectPii } from './pii_detector';
export { maskPii } from './pii_masker';
export type { PiiMatch } from './pii_detector';
export type { PiiPattern } from './pii_patterns';
