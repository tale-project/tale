/**
 * The opaque `state` value of the OAuth2 authorization-code flow.
 *
 * `state` is the only thing tying a callback back to the authorization that
 * started it, and it travels through the user's browser and the vendor's
 * servers. It is therefore generated as pure randomness and stored HASHED (see
 * `schema.ts`): the browser holds a bearer token, the database holds only a
 * verifier for it. Nothing about the organization, the user or the connector is
 * encoded in the value — those live on the server-side row, so a caller cannot
 * influence them by editing the parameter.
 *
 * Web Crypto only, so this runs unchanged in the V8 HTTP-action runtime.
 */

/**
 * Lifetime of a pending authorization. Long enough for a consent screen that
 * includes signing in and picking an account, short enough that an abandoned
 * flow's token is worthless by the time anyone could find it.
 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 256 bits — the same entropy budget as a session token. */
const STATE_TOKEN_BYTES = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** A fresh, unguessable state token for one authorization attempt. */
export function mintStateToken(): string {
  return base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(STATE_TOKEN_BYTES)),
  );
}

/**
 * SHA-256 of a state token, hex encoded — what the pending row stores and what
 * the callback looks up by.
 */
export async function hashStateToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Bound on the state value we are willing to hash. A legitimate token is 43
 * characters; anything longer is a probe, and refusing it early keeps a flood
 * of megabyte "states" from turning the callback into a digest mill.
 */
const STATE_MAX_LENGTH = 256;

/** Reject a state parameter that cannot be one of ours before hashing it. */
export function isPlausibleStateToken(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= STATE_MAX_LENGTH;
}
