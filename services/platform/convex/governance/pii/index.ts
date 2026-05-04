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
  const custom: PiiPattern[] = [];
  for (const cp of config.customPatterns ?? []) {
    // Defense-in-depth: the schema (`piiCustomPatternSchema`) already rejects
    // bad regex syntax at save-time, but a stale config / direct DB write could
    // still reach here. Skip with a warn rather than throwing so `scrubPii`
    // honours its "never throws" docstring contract.
    try {
      custom.push({
        name: cp.name,
        regex: new RegExp(cp.regex, 'g'),
        replacement: cp.replacement,
      });
    } catch (err) {
      console.warn(
        `[pii_index] customPattern "${cp.name}" failed to compile: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
    }
  }
  return [...builtIn, ...custom];
}

/**
 * Pure PII scrubber. Returns a FilterOutcome (never throws). The `sanitize.ts`
 * dispatcher converts `blocked` into a ConvexError with legacy substring so
 * old clients continue to match via `.includes('Message blocked: PII')`.
 *
 * Input is normalized to NFC at the entrypoint so that NFD-encoded text
 * (common from macOS clipboard, some IMEs) doesn't bypass detectors that
 * embed precomposed characters in their patterns (e.g. `Tél` containing a
 * literal `é`). The masked output is therefore in NFC form too — consistent
 * with the existing contract that `scrubPii` may rewrite the text. NFC is
 * idempotent so this is safe to apply once at the boundary.
 *
 * Browser-safe: pure regex + string ops + checksum validators, no Node-only
 * APIs.
 */
export function scrubPii(text: string, config: PiiConfig): FilterOutcome {
  if (!config.enabled) return pass();

  const normalized = text.normalize('NFC');
  const patterns = buildPatterns(config);
  const matches = detectPii(normalized, patterns);
  if (matches.length === 0) return pass();

  const detectedTypes = [...new Set(matches.map((m) => m.patternName))];

  if (config.mode === 'block') {
    return blocked(detectedTypes, matches.length);
  }

  const maskedText = maskPii(normalized, matches);
  return modified(maskedText, detectedTypes, matches.length);
}

export { BUILT_IN_PII_PATTERNS } from './pii_patterns';
export { detectPii, dedupOverlaps } from './pii_detector';
export { maskPii } from './pii_masker';
export type { PiiMatch } from './pii_detector';
export type { PiiMatchSpan, PiiPattern } from './pii_patterns';
