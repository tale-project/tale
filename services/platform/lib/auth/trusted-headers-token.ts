/**
 * Generate session tokens for trusted header authentication
 *
 * This module handles session management for users authenticated via
 * trusted headers (external auth proxies like Authelia/Authentik).
 *
 * IMPORTANT: This handles account switching correctly by:
 * - Detecting when the user in headers differs from the session user
 * - Deleting old sessions when users switch accounts
 * - Creating new sessions for the current user
 */

import type { NextRequest } from 'next/server';
import { fetchMutation } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import {
  extractTrustedHeaders,
  isTrustedHeadersEnabled,
  type TrustedHeadersUser,
} from './trusted-headers';

/**
 * Sign a Better Auth session token using the same HMAC scheme that Better Auth
 * uses for `setSignedCookie` / `getSignedCookie`.
 *
 * This produces a value of the form:
 *   `${token}.${base64Signature}`
 * which `better-call` will validate and then return the original `token` from
 * `getSignedCookie`.
 */
async function signSessionTokenForCookie(
  sessionToken: string,
): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set; it is required to sign Better Auth session cookies in trusted-headers mode.',
    );
  }

  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error(
      'Web Crypto API is not available in this runtime; cannot sign Better Auth session cookie.',
    );
  }

  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    encoder.encode(sessionToken),
  );
  const signatureBytes = new Uint8Array(signatureBuffer);
  let binary = '';
  for (let i = 0; i < signatureBytes.length; i += 1) {
    binary += String.fromCharCode(signatureBytes[i]);
  }
  const signatureBase64 = btoa(binary);
  return `${sessionToken}.${signatureBase64}`;
}

/**
 * Authenticate user via trusted headers and manage session
 *
 * This function:
 * 1. Extracts user info from trusted headers
 * 2. Finds or creates the user in Convex (and updates name/role if changed)
 * 3. Checks if there's an existing session cookie
 * 4. If the session belongs to a different user, deletes it
 * 5. Creates or reuses a session for the current user
 * 6. Returns the session token and whether to clear old cookies
 *
 * CRITICAL: This handles account switching by detecting when the user
 * in the headers differs from the user in the existing session.
 *
 * Returns null if trusted headers are not enabled or headers are missing
 */
export async function authenticateViaTrustedHeaders(
  request: NextRequest,
): Promise<{
  sessionToken: string;
  /**
   * HMAC-signed value to use in the Better Auth session cookie.
   * This matches what `getSignedCookie` expects and allows `/convex/token`
   * (and thus `/api/auth/convex/token`) to see the session.
   */
  signedSessionToken: string;
  user: TrustedHeadersUser;
  shouldClearOldSession: boolean;
  trustedHeadersChanged: boolean;
} | null> {
  // Check if trusted headers are enabled
  if (!isTrustedHeadersEnabled()) {
    return null;
  }

  // Extract user info from headers
  const headerUser = extractTrustedHeaders(request);

  console.log('Trusted headers user:', JSON.stringify(headerUser, null, 2));

  if (!headerUser) {
    return null;
  }

  try {
    // Get the existing session token from cookies (if any)
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const isHttps = siteUrl.startsWith('https://');
    const cookieName = isHttps
      ? '__Secure-better-auth.session_token'
      : 'better-auth.session_token';
    const existingSessionToken = request.cookies.get(cookieName)?.value;

    // Optional internal secret to ensure only our backend can call this
    const internalSecret = process.env.TRUSTED_HEADERS_INTERNAL_SECRET;

    // Perform full authentication + session handling in a single Convex call
    const result = await fetchMutation(
      api.trusted_headers_authenticate.trustedHeadersAuthenticate,
      {
        email: headerUser.email,
        name: headerUser.name,
        role: headerUser.role,
        teams: headerUser.teams,
        existingSessionToken,
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        secret: internalSecret,
      },
    );

    if (!result || !result.sessionToken) {
      console.error('Failed to authenticate trusted header user');
      return null;
    }

    const signedSessionToken = await signSessionTokenForCookie(
      result.sessionToken,
    );

    return {
      sessionToken: result.sessionToken,
      signedSessionToken,
      user: headerUser,
      shouldClearOldSession: result.shouldClearOldSession,
      trustedHeadersChanged: result.trustedHeadersChanged,
    };
  } catch (error) {
    console.error('Error authenticating via trusted headers:', error);
    return null;
  }
}

/**
 * Check if a request should use trusted headers authentication
 */
export function shouldUseTrustedHeaders(): boolean {
  return isTrustedHeadersEnabled();
}
