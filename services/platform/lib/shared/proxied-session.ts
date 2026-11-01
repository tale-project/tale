import { isRecord } from '../utils/type-utils.ts';

/**
 * Whether an authenticating proxy asserted this session. The trusted-headers
 * door writes the role the proxy asserted, and the proxy owns signing in and
 * out for that session, so the app offers no sign-out of its own. A single
 * sign-on session is bound to its organization too, but asserts no role: its
 * person signs out in the app (#5137). Read loosely: the field is one of the
 * deployment's own session columns, not part of the client's inferred type.
 */
export function isProxiedSession(session: unknown): boolean {
  return isRecord(session) && typeof session.trustedRole === 'string';
}
