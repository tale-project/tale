/**
 * OpenID Connect discovery (#1506).
 *
 * A generic OIDC identity provider (Keycloak, Auth0, Okta, Google, …) publishes
 * its endpoints at `${issuer}/.well-known/openid-configuration`. Unlike the
 * Entra adapter — which constructs Microsoft URLs from the tenant id — a
 * generic adapter must read the authorization, token, and userinfo endpoints
 * from that document. The adapter resolves discovery per auth flow (login is
 * infrequent and the document is cacheable), so no endpoint is persisted.
 */

import { isRecord } from '../../../lib/utils/type-utils';

export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Optional per the OIDC spec, but required for our user-info mapping. */
  userinfoEndpoint?: string;
  jwksUri?: string;
}

function wellKnownUrl(issuer: string): string {
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return `${trimmed}/.well-known/openid-configuration`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Network timeout for OIDC endpoint fetches — a login flow must fail fast if
 *  the IdP is unreachable rather than hang on a stuck socket. */
export const OIDC_FETCH_TIMEOUT_MS = 10_000;

// Short-lived in-memory cache keyed by issuer. A single login callback resolves
// discovery several times (token exchange, userinfo, group sync); caching folds
// those into one network call. Best-effort per isolate, never persisted; the
// TTL bounds staleness so a rotated endpoint is picked up within minutes.
const DISCOVERY_TTL_MS = 5 * 60_000;
const discoveryCache = new Map<
  string,
  { endpoints: OidcEndpoints; expiresAt: number }
>();

/** Test-only: drop cached discovery between cases. */
export function resetOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}

/**
 * Fetch and validate the issuer's discovery document. Throws on an
 * unreachable issuer or a document missing the authorization/token endpoints
 * (a provider with neither cannot run the authorization-code flow).
 */
export async function discoverOidc(issuer: string): Promise<OidcEndpoints> {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.endpoints;
  }

  const url = wellKnownUrl(issuer);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `OIDC discovery failed: could not reach ${url} (${
        err instanceof Error ? err.message : 'network error'
      })`,
      { cause: err },
    );
  }
  if (!response.ok) {
    throw new Error(
      `OIDC discovery failed: ${url} returned ${response.status}`,
    );
  }

  const doc: unknown = await response.json();
  if (!isRecord(doc)) {
    throw new Error(
      `OIDC discovery failed: ${url} did not return a JSON object`,
    );
  }

  const authorizationEndpoint = asString(doc['authorization_endpoint']);
  const tokenEndpoint = asString(doc['token_endpoint']);
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error(
      'OIDC discovery failed: document is missing authorization_endpoint or token_endpoint',
    );
  }

  const endpoints: OidcEndpoints = {
    issuer: asString(doc['issuer']) ?? issuer,
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint: asString(doc['userinfo_endpoint']),
    jwksUri: asString(doc['jwks_uri']),
  };
  discoveryCache.set(issuer, {
    endpoints,
    expiresAt: Date.now() + DISCOVERY_TTL_MS,
  });
  return endpoints;
}
