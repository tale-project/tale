/**
 * The OAuth pieces both providers share: PKCE, the callback parse, and the
 * bits of a token response that every vendor spells the same way.
 *
 * Both subscriptions use the public OAuth client their own CLI ships with —
 * the authorization-code grant with a PKCE S256 challenge — so the mechanics
 * live here and each module keeps only its endpoints and its payload shapes.
 */

import { createHash, randomBytes } from 'node:crypto';

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** A PKCE S256 pair: the verifier to keep, the challenge to send. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A high-entropy, URL-safe `state` value. */
export function generateState(): string {
  return base64Url(randomBytes(32));
}

/**
 * Read the authorization code out of whatever the person pasted back.
 *
 * Three shapes reach the panel, and all three are honest answers to "copy what
 * the browser gave you": the whole redirect URL (`http://localhost:1455/auth/
 * callback?code=…&state=…`), the `code#state` pair Anthropic's console page
 * prints, or the bare code. Anything with a `?`/`&` query is parsed as a URL;
 * otherwise the `#` separator decides.
 */
export function parseAuthorizationCallback(pasted: string): {
  code: string;
  state: string | null;
} {
  const trimmed = pasted.trim();
  if (!trimmed) return { code: '', state: null };

  const queryAt = trimmed.indexOf('?');
  if (queryAt !== -1) {
    const params = new URLSearchParams(trimmed.slice(queryAt + 1));
    const code = params.get('code');
    if (code) return { code: code.trim(), state: params.get('state') };
  }

  const hashAt = trimmed.indexOf('#');
  if (hashAt !== -1) {
    return {
      code: trimmed.slice(0, hashAt).trim(),
      state: trimmed.slice(hashAt + 1).trim() || null,
    };
  }

  return { code: trimmed, state: null };
}

/** `expires_in` seconds, as the ISO-8601 instant this gateway stores. */
export function expiresAtFrom(
  expiresIn: unknown,
  now: Date = new Date(),
): string | null {
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) return null;
  return new Date(now.getTime() + expiresIn * 1000).toISOString();
}

/** A vendor timestamp — ISO string, or epoch seconds — as ISO-8601, or null. */
export function toIsoInstant(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds, not milliseconds: every window a provider reports resets
    // within days, so a value that small can only be a second count.
    const parsed = new Date(value * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A relative "resets in N seconds" as the absolute instant this gateway keeps. */
export function resetsAtFromSeconds(
  seconds: unknown,
  now: Date = new Date(),
): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/** Percent-shaped vendor field, clamped to the 0–100 the panel draws. */
export function toUtilization(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/** A JSON value that is a plain object, narrowed without an assertion. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A vendor response body, as the loose record the readers below expect. */
export async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return isRecord(body) ? body : {};
}

/** Decode a JWT's payload without verifying it. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  // The gateway is not the audience of these tokens and never trusts them for
  // authorization — it reads the account's own e-mail and handle out of the
  // id_token the vendor just handed it over TLS, to label a row. Verification
  // would need the vendor's JWKS for no decision this code makes.
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    return isRecord(decoded) ? decoded : null;
  } catch (error) {
    console.warn('[ai-gateway] could not decode id_token claims:', error);
    return null;
  }
}

/** A string field from a loosely-typed vendor payload, or null. */
export function readString(
  source: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** A nested object from a loosely-typed vendor payload. */
export function readObject(
  source: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key];
  return isRecord(value) ? value : null;
}
