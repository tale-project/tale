/**
 * Claim resolution for generic OIDC providers (#1506).
 *
 * Identity providers rarely agree on where a claim lives: Keycloak emits roles
 * at `realm_access.roles`, Auth0 uses namespaced URLs, others flatten
 * everything to the top level. Dot-path resolution lets an operator point role
 * rules and claim mappings at any of these without provider-specific code.
 */

import { isRecord } from '../../../lib/utils/type-utils';

/**
 * Resolve a dot-path (e.g. `realm_access.roles`) inside a claims object.
 * Returns `undefined` when any segment is missing or not an object.
 */
export function resolveClaimPath(claims: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = claims;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Normalise a claim value to a string list: a string becomes a one-element
 * list, an array keeps only its string entries, anything else is empty.
 */
export function claimValueToStrings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/**
 * The email an adapter resolved for the signed-in user, or a readable error
 * when the IdP sent none. Every adapter funnels its candidates (mapped claim,
 * standard claim, fallback) through here so a scope set without `email`, a
 * userinfo endpoint that emits only `sub`, or a mistyped `claimMappings.email`
 * path surfaces as "the email claim is missing" — on the login page and in
 * the audit row — instead of a `TypeError` from the first `.toLowerCase()`
 * downstream. `source` names the response for the operator (e.g. "OIDC
 * userinfo").
 */
export function requireEmailClaim(candidate: unknown, source: string): string {
  if (typeof candidate === 'string' && candidate.trim() !== '') {
    return candidate;
  }
  throw new Error(
    `${source} response carries no email for the signed-in user — check the requested scopes and the email claim mapping`,
  );
}

// Convex object field names must be non-empty printable ASCII and must not
// start with `$` or `_`. IdPs occasionally emit claims that violate this
// (non-ASCII keys, leading underscores); dropping those keys keeps the login
// alive instead of failing arg validation on the internal action.
const CONVEX_SAFE_KEY = /^[\x20-\x7E]+$/;

function isConvexSafeKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith('$') &&
    !key.startsWith('_') &&
    CONVEX_SAFE_KEY.test(key)
  );
}

/**
 * Drop top-level claims whose keys Convex cannot carry as record fields.
 * Logs what it drops so an operator can spot a missing claim.
 */
export function sanitizeRawClaims(
  claims: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!claims) return undefined;
  const dropped = Object.keys(claims).filter((key) => !isConvexSafeKey(key));
  if (dropped.length === 0) return claims;
  console.warn(
    '[SSO] Dropping userinfo claims with Convex-incompatible keys:',
    dropped,
  );
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (isConvexSafeKey(key)) sanitized[key] = value;
  }
  return sanitized;
}
