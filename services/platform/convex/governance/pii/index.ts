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

export interface ScrubResult {
  text: string;
  detectedTypes: string[];
  matchCount: number;
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

export function scrubPii(text: string, config: PiiConfig): ScrubResult {
  if (!config.enabled) {
    return { text, detectedTypes: [], matchCount: 0 };
  }

  const patterns = buildPatterns(config);
  const matches = detectPii(text, patterns);

  if (matches.length === 0) {
    return { text, detectedTypes: [], matchCount: 0 };
  }

  const detectedTypes = [...new Set(matches.map((m) => m.patternName))];

  if (config.mode === 'block') {
    const typeLabels = detectedTypes.join(', ');
    throw new Error(
      `Message blocked: PII detected (${typeLabels}). Please remove personal data before sending.`,
    );
  }

  const maskedText = maskPii(text, matches);
  return {
    text: maskedText,
    detectedTypes,
    matchCount: matches.length,
  };
}

export { BUILT_IN_PII_PATTERNS } from './pii_patterns';
export { detectPii } from './pii_detector';
export { maskPii } from './pii_masker';
export type { PiiMatch } from './pii_detector';
export type { PiiPattern } from './pii_patterns';
