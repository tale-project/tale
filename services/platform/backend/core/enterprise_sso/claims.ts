/**
 * Claim resolution for generic OIDC providers (#1506).
 *
 * Identity providers rarely agree on where a claim lives: Keycloak emits roles
 * at `realm_access.roles`, Auth0 under namespaced URLs such as
 * `https://example.com/roles`, SAML IdPs under attribute URIs, others flatten
 * everything to the top level. Dot-path resolution that reads a dotted name as
 * written first (#4775) lets an operator point role rules and claim mappings at
 * any of these without provider-specific code.
 */

import { isRecord } from '../../../lib/utils/type-utils';

/**
 * Resolve a claim path (e.g. `realm_access.roles`) inside a claims object.
 * Dots lead into nested claims, but a claim whose own name contains dots
 * (`https://example.com/roles`, `urn:oid:1.3.6.1.4.1.5923.1.1.1.1`) is read as
 * written: at each level the longest name the claims carry is tried first, and
 * a shorter one when the longer leads nowhere. Only own keys are read, never
 * inherited ones. Returns `undefined` when no reading of the path reaches a
 * value.
 */
export function resolveClaimPath(claims: unknown, path: string): unknown {
  if (!path) return undefined;
  return resolveSegments(claims, path.split('.'));
}

function resolveSegments(current: unknown, segments: string[]): unknown {
  if (segments.length === 0) return current;
  if (!isRecord(current)) return undefined;
  for (let end = segments.length; end > 0; end--) {
    const key = segments.slice(0, end).join('.');
    if (!Object.hasOwn(current, key)) continue;
    const value = resolveSegments(current[key], segments.slice(end));
    if (value !== undefined) return value;
  }
  return undefined;
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
 * path surfaces as a readable error instead of a `TypeError` from the first
 * `.toLowerCase()` downstream. The callback handler writes that message to the
 * audit row of the failed sign-in; the login page shows only the generic
 * `sso.errors.serverError`. `source` names the response for the operator (e.g.
 * "OIDC userinfo").
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
