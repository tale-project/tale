import { isRecord } from '../utils/type-utils.ts';

/**
 * Whether an authenticating proxy signed this session in. The trusted-headers
 * door marks the sessions it writes (`signedInByProxy`), and the proxy owns
 * signing in and out for them, so the app offers no sign-out of its own. The
 * role a session names is its ceiling alone: a single sign-on session names
 * none (#5137), and a passkey enrolled behind a proxy names the proxy's role
 * on every later sign-in, though its person signed in on Tale's own form and
 * signs out in the app (#5259). Read loosely: the field is one of the
 * deployment's own session columns, not part of the client's inferred type.
 */
export function isProxiedSession(session: unknown): boolean {
  return isRecord(session) && session.signedInByProxy === true;
}
