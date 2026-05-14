import type { PiiPattern, PiiPatternFactory } from '../core/types';

const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

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
    console.warn(
      `[pii] Base64URL decode error: ${err instanceof Error ? err.name : 'unknown'}`,
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
  } catch (err) {
    console.warn(
      `[pii] JSON parse error in JWT segment: ${err instanceof Error ? err.name : 'unknown'}`,
    );
    return false;
  }
}

const PATTERN: PiiPattern = {
  name: 'jwt',
  regex: JWT_REGEX,
  validate: (m) => {
    const parts = m.split('.');
    if (parts.length !== 3) return false;
    return isJsonObjectSegment(parts[0]) && isJsonObjectSegment(parts[1]);
  },
  replacement: '[JWT]',
};

export const jwtFactory: PiiPatternFactory = () => [PATTERN];
