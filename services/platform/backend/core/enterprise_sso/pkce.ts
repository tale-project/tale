/**
 * PKCE (RFC 7636, S256) for the SSO authorization-code flow (#1506).
 *
 * The verifier is generated at /sso/authorize time and must come back at the
 * token exchange. The flow is stateless (no server-side session between the
 * two HTTP actions), so the caller carries the verifier inside the signed
 * state parameter — encrypted, because state round-trips through the
 * browser and the IdP.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface PkcePair {
  /** The high-entropy secret sent at the token exchange. */
  verifier: string;
  /** base64url(SHA-256(verifier)) sent on the authorize URL. */
  challenge: string;
}

/** Generate a PKCE verifier/challenge pair using the S256 method. */
export async function generatePkcePair(): Promise<PkcePair> {
  // 32 random bytes -> 43 base64url chars, inside RFC 7636's 43-128 window.
  const random = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(random);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}
