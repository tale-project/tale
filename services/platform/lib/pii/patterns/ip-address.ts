/**
 * IP address — data regex plus `validator`'s `isIP` range/compression
 * check. Zone identifiers (`fe80::1%eth0`) are stripped before validation:
 * `isIP` does not understand them, and a valid IPv6 with a zone is still
 * PII. Private/reserved ranges are masked deliberately — internal topology
 * and host identity are PII too.
 */

import isIP from 'validator/lib/isIP';

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

export const buildIpAddressPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      try {
        const stripped = m.includes('%') ? m.slice(0, m.indexOf('%')) : m;
        return isIP(stripped);
      } catch (err) {
        console.warn(
          `[pii] IP address validation error: ${err instanceof Error ? err.name : 'unknown'}`,
        );
        return false;
      }
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
