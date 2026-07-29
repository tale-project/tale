/**
 * JWT — data regex plus structural validation: the first two dot-separated
 * segments must Base64URL-decode to JSON objects. That kills lookalike
 * strings (minified code, random tokens) that merely start with `eyJ`.
 */

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function decodeBase64Url(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return utf8Decoder.decode(bytes);
  } catch (err) {
    console.debug(
      `[pii] JWT Base64URL decode error: ${err instanceof Error ? err.name : 'unknown'}`,
    );
    return null;
  }
}

function isJsonObjectSegment(segment: string): boolean {
  const decoded = decodeBase64Url(segment);
  if (decoded === null) return false;
  try {
    const parsed: unknown = JSON.parse(decoded);
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    // Not JSON — an ordinary rejection for a non-JWT candidate, not an
    // error worth a log line per match.
    return false;
  }
}

export const buildJwtPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      const parts = m.split('.');
      if (parts.length !== 3) return false;
      return isJsonObjectSegment(parts[0]) && isJsonObjectSegment(parts[1]);
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
