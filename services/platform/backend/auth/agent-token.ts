import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { decodeProtectedHeader, errors as joseErrors } from 'jose';
import type { JSONWebKeySet } from 'jose';

import { scopesOf } from '../../lib/shared/agent-access.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import { OIDC_ORGANIZATION_CLAIM } from './oidc.ts';

/**
 * The access token a coding agent presents at the MCP endpoint, proved
 * without asking the sign-in server anything: its signature against the keys
 * the server publishes, its issuer, its audience (this endpoint, on an
 * address the deployment answers on), its type and its lifetime. What the
 * token says of the connection behind it — whether that connection is still
 * live, whether its person still has a seat — is not in the token: the door
 * reads it on every call (`rest/agent-door.ts`), so ending a connection ends
 * its access at once, whatever tokens the agent still holds.
 */

/** The facts of a verified access token the door acts on. */
export interface AgentAccessToken {
  /** The person who connected the agent. */
  readonly userId: string;
  /** The app, by its OAuth client id. */
  readonly clientId: string;
  /** The organization the connection was made for. */
  readonly organizationId: string;
  /** The scopes the token carries. */
  readonly scopes: readonly string[];
  /** When the token was minted, in epoch milliseconds. */
  readonly issuedAtMs: number;
}

export type AgentTokenVerdict =
  | { readonly ok: true; readonly token: AgentAccessToken }
  | {
      readonly ok: false;
      /** `expired`: a token that was good and ran out — the normal moment
       * for an agent to refresh. `invalid`: anything else that is not a
       * token this endpoint issued for itself. `unsupported`: a token bound
       * to a key of the agent's (DPoP), which this endpoint does not take. */
      readonly reason: 'expired' | 'invalid' | 'unsupported';
      /** A sentence that goes into the challenge — fixed text, nothing of
       * the token. */
      readonly description: string;
    };

export interface AgentTokenDeps {
  /** The issuer the tokens name: the sign-in server's own address. */
  readonly issuer: string;
  /** The endpoint's address on every origin the deployment answers on; a
   * token names one of them as its audience. */
  readonly resources: readonly string[];
  /** The keys the sign-in server publishes. */
  readonly jwks: () => Promise<JSONWebKeySet | undefined>;
  /** Keeps the fetched keys for a few minutes: one object for the life of
   * the process. */
  readonly cacheKey: object;
}

const INVALID = {
  ok: false,
  reason: 'invalid',
  description: 'The access token is not valid for this endpoint',
} as const;

/**
 * The sign-in server's own address — the issuer its tokens name: the auth
 * instance's base URL and the mount of its endpoints. The one spelling of
 * it, for the discovery documents and for the door that checks the tokens.
 */
export function agentIssuer(auth: {
  options: { baseURL?: string | undefined };
}): string {
  const base = auth.options.baseURL ?? process.env.SITE_URL ?? '';
  return `${base.replace(/\/$/, '')}/api/auth`;
}

/** The type the sign-in server gives its access tokens (RFC 9068). */
const ACCESS_TOKEN_TYPE = 'at+jwt';

/** A refusal of a token the keys could not be fetched for is not a refusal
 * of the token: the keys come from the database, which may be unavailable. */
function isInfrastructureError(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWKSInvalid
  );
}

/**
 * Whether a bearer value is shaped like a signed token — three dot-separated
 * parts in base64url. An API key has no dot, so the two never mix.
 */
export function looksLikeJwt(bearer: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(bearer);
}

/**
 * Verify an agent's access token. Answers a verdict for every token a
 * client can send; throws only when the keys cannot be fetched (the
 * database is unavailable), which the door answers as an outage rather than
 * as a refusal of the token.
 */
export async function verifyAgentAccessToken(
  token: string,
  deps: AgentTokenDeps,
): Promise<AgentTokenVerdict> {
  if (deps.resources.length === 0) return INVALID;
  try {
    decodeProtectedHeader(token);
  } catch {
    // Not a token at all: a value of the right shape that no signer made.
    return INVALID;
  }
  let payload;
  try {
    payload = await verifyJwsAccessToken(token, {
      jwksFetch: deps.jwks,
      jwksCacheKey: deps.cacheKey,
      verifyOptions: {
        issuer: deps.issuer,
        audience: [...deps.resources],
        algorithms: ['RS256'],
        typ: ACCESS_TOKEN_TYPE,
      },
    });
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return {
        ok: false,
        reason: 'expired',
        description: 'The access token has expired',
      };
    }
    if (
      error instanceof joseErrors.JOSEError &&
      !isInfrastructureError(error)
    ) {
      return INVALID;
    }
    throw error;
  }
  if (payload.cnf !== undefined) {
    return {
      ok: false,
      reason: 'unsupported',
      description: 'This endpoint accepts Bearer tokens only',
    };
  }
  const organization = payload[OIDC_ORGANIZATION_CLAIM];
  const organizationId = isRecord(organization) ? organization.id : undefined;
  const { sub, azp, iat, scope } = payload;
  if (
    typeof sub !== 'string' ||
    sub === '' ||
    typeof azp !== 'string' ||
    azp === '' ||
    typeof organizationId !== 'string' ||
    organizationId === '' ||
    typeof iat !== 'number' ||
    typeof scope !== 'string'
  ) {
    return INVALID;
  }
  return {
    ok: true,
    token: {
      userId: sub,
      clientId: azp,
      organizationId,
      scopes: scopesOf(scope),
      issuedAtMs: iat * 1000,
    },
  };
}
