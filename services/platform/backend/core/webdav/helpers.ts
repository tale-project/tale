// Shared helpers for the webdav module.
// Pure Web-Crypto + string utilities — work in both Convex isolate and Node.
//
// MIRROR OF lib/webdav/auth.ts — keep these in sync. The Convex isolate
// cannot import from lib/ (different runtime / bundler boundary), so
// `hexToBytes` / `encodeText` / `bytesToHex` / `hmacHash` /
// `timingSafeEqual` live in two places. If you change one, change both
// — the auth + login fast-path depends on byte-for-byte parity.

const HMAC_KEY_ENV = 'WEBDAV_APP_PASSWORD_HMAC_KEY';

// Hex pattern used to validate both the deployment HMAC secret and any
// `hexToBytes` input. Anchored on both ends + case-insensitive — the
// upstream `openssl rand -hex 32` output is lowercase but operators
// occasionally paste uppercase.
const HEX_RE = /^[0-9a-f]+$/i;

export function requireHmacSecret(): string {
  const raw = process.env[HMAC_KEY_ENV];
  if (!raw) {
    throw new Error(
      `${HMAC_KEY_ENV} is unset; set via 'convex env set ${HMAC_KEY_ENV}=$(openssl rand -hex 32)'`,
    );
  }
  // 64 hex chars = 256 bits — matches the documented `openssl rand -hex
  // 32` recommendation. Anything shorter weakens HMAC-SHA256 enough
  // that a leaked DB hash could be ground out offline. Reject rather
  // than silently degrading.
  if (raw.length < 64) {
    throw new Error(
      `${HMAC_KEY_ENV} is too short (got ${raw.length} chars, need >= 64); set via 'convex env set ${HMAC_KEY_ENV}=$(openssl rand -hex 32)'`,
    );
  }
  // Even-length is required so `hexToBytes` can pair nibbles.
  if (raw.length % 2 !== 0) {
    throw new Error(
      `${HMAC_KEY_ENV} has odd length (${raw.length}); expected an even number of hex chars`,
    );
  }
  if (!HEX_RE.test(raw)) {
    // parseInt('zz', 16) silently coerces to NaN → 0, which would
    // produce an all-zero key without this guard. Refuse to start.
    throw new Error(
      `${HMAC_KEY_ENV} contains non-hex characters; expected only [0-9a-f] after 'openssl rand -hex 32'`,
    );
  }
  return raw;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  // Defense in depth: requireHmacSecret() should have rejected any
  // bad input already, but `parseInt('zz', 16) === NaN` silently
  // coerces to 0, so an unvalidated path would produce zero bytes.
  // Fail loudly instead.
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new Error('hexToBytes: input is not valid even-length hex');
  }
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeText(s: string): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(utf8.byteLength);
  new Uint8Array(buf).set(utf8);
  return new Uint8Array(buf);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function hmacHash(
  plaintext: string,
  secretHex: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encodeText(plaintext));
  return bytesToHex(new Uint8Array(sig));
}

// Constant-time string compare for HMAC outputs (both sides are the same
// length hex). Don't substitute `===` — early-exit timing leaks the
// position of the first mismatched byte.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// 32-char URL-safe random secret. base64url over 24 random bytes.
export function generateAppPasswordSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url, no padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Canonical WebDAV resource path used as the lock key. Strips trailing
// slash on collections so /folder and /folder/ resolve to the same lock.
export function canonicalResourcePath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}
