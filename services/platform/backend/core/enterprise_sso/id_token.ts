import { isRecord } from '../../../lib/utils/type-utils';

/**
 * The claims of an ID token the token endpoint handed us.
 *
 * The token arrives over TLS in the authorization-code exchange, straight
 * from the IdP and never through the browser, so its claims are trusted the
 * way the access token next to it is and no signature check is repeated
 * here (the browser-supplied `state`, by contrast, is verified before it is
 * read). `undefined` for anything that is not a three-part JWT whose payload
 * is a JSON object. The payload is decoded as base64url, so a claim with
 * non-ASCII text (a name with an umlaut) survives intact.
 */
export function decodeIdTokenPayload(
  idToken: string,
): Record<string, unknown> | undefined {
  const parts = idToken.split('.');
  const segment = parts[1];
  if (parts.length !== 3 || !segment) {
    return undefined;
  }
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    );
    return isRecord(payload) ? payload : undefined;
  } catch (error) {
    console.warn('[SSO] ID token payload is not a JSON object:', error);
    return undefined;
  }
}
