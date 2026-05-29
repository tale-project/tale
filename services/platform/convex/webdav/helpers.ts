// Shared helpers for the webdav module.
// Pure Web-Crypto + string utilities — work in both Convex isolate and Node.

const HMAC_KEY_ENV = 'WEBDAV_APP_PASSWORD_HMAC_KEY';

export function requireHmacSecret(): string {
  const raw = process.env[HMAC_KEY_ENV];
  if (!raw || raw.length < 32) {
    // 32 hex chars = 16 bytes — minimum we accept. Below that the HMAC
    // is weak enough that a leaked DB row could be ground out offline.
    throw new Error(
      `${HMAC_KEY_ENV} is unset or too short; set via 'convex env set ${HMAC_KEY_ENV}=$(openssl rand -hex 32)'`,
    );
  }
  return raw;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
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
