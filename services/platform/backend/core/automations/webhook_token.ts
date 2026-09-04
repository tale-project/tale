/**
 * The bearer token that guards a webhook trigger.
 *
 * The URL a vendor calls is the whole credential, so the token is pure
 * randomness and the database stores only its SHA-256: the caller holds a
 * bearer token, the row holds a verifier for it. It is shown once, at creation
 * — a leaked webhook URL is rotated by minting a new token, never by reading
 * the old one back out of the store.
 *
 * Web Crypto only, so this runs unchanged in the V8 HTTP-action runtime.
 */

/** 256 bits — the same entropy budget as a session token. */
const TOKEN_BYTES = 32;

/**
 * Bound on what we are willing to hash. A legitimate token is 43 characters;
 * anything longer is a probe, and refusing it early keeps a flood of megabyte
 * "tokens" from turning the webhook route into a digest mill.
 */
const TOKEN_MAX_LENGTH = 256;

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** A fresh, unguessable webhook token. Returned to its creator once. */
export function mintWebhookToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Hex SHA-256 of a string (UTF-8) or of raw bytes — the one digest the
 * webhook lane uses for its token verifier and its delivery identities. */
export async function sha256Hex(
  input: string | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** SHA-256 of a token, hex encoded — what the trigger row stores. */
export function hashWebhookToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Reject a value that cannot be one of ours before hashing it. */
export function isPlausibleWebhookToken(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= TOKEN_MAX_LENGTH;
}

/**
 * Constant-time compare of two hex digests. Both sides are the same length, so
 * `===` would leak the position of the first differing byte through its
 * early exit; this one always reads both strings to the end.
 */
export function tokenHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
