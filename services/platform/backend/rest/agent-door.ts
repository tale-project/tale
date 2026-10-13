import type { Context } from 'hono';
import type { JSONWebKeySet } from 'jose';
import type { Sql } from 'postgres';

import { isAgentScope, MCP_PATH } from '../../lib/shared/agent-access.ts';
import { mcpChallenge } from '../auth/agent-challenge.ts';
import { configuredMcpResources } from '../auth/agent-oauth.ts';
import { verifyAgentAccessToken } from '../auth/agent-token.ts';
import { findLiveConnectionSeat } from '../domains/agent_connections/seat.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';
import { restRateLimited, type RestEnv } from './shared.ts';

/**
 * The part of the REST door that admits a coding agent signed in to the MCP
 * endpoint: the request carries the agent's access token (a signed token,
 * not an API key) and the door proves, in order, that the token is one this
 * endpoint issued for itself and is still good, that the connection behind
 * it is live and was made no later than the token, that its person still has
 * a seat in the organization it was made for, and that the caller did not
 * ask for another organization. Then the call acts as that person, in that
 * organization, with their role now — and with the access they allowed the
 * agent, which narrows the role and never widens it.
 *
 * Only the MCP endpoint takes a token: on every other route a value of this
 * shape is read as the API key it can only be, and refused as one.
 */

/** Whether a request is for the MCP endpoint — the one route an agent's
 * token opens. */
export function isMcpRoute(path: string): boolean {
  return path === MCP_PATH;
}

/** A token minted a moment before its connection was recorded is still that
 * connection's: the clock of another instance, a second's rounding. */
const MINT_SKEW_MS = 5_000;

export interface AgentDoorDeps {
  readonly sql: Sql;
  /** The keys the sign-in server signs with (`auth.api.getJwks`). */
  readonly jwks: () => Promise<JSONWebKeySet | undefined>;
  /** The sign-in server's own address. */
  readonly issuer: string;
  /** Keeps the keys for a few minutes: one object for the life of the
   * door, which the verifier caches them under. */
  readonly keyCache: object;
}

/** The 401 of a token or a connection that does not open the endpoint: the
 * flat envelope, and a challenge that tells the agent where to sign in. */
function refusedToken(c: Context<RestEnv>, description: string): Response {
  return c.json({ error: description, code: 'UNAUTHORIZED' }, 401, {
    'www-authenticate': mcpChallenge(c.req.raw, {
      error: 'invalid_token',
      description,
    }),
  });
}

/** The scopes an agent holds for this request. Access — a scope of the
 * agent kind — is what its token carries that its connection still holds: a
 * person who allowed less since narrows the agent at once, one who allowed
 * more is not felt until the next token. A scope that is no access (staying
 * connected) passes on from the token, so that a refusal that asks for more
 * never asks for less than the agent had. */
function heldScopes(
  token: readonly string[],
  connection: readonly string[],
): ReadonlySet<string> {
  const allowed = new Set(connection);
  return new Set(
    token.filter((scope) => !isAgentScope(scope) || allowed.has(scope)),
  );
}

const ONE_ORGANIZATION = (slug: string) =>
  `This agent connection is for "${slug}" and cannot act in another organization. Connect the agent again to use a different one.`;

/**
 * Admit the request made with an agent's access token, or answer why not.
 * On success the request's variables are set — the person, the organization
 * the connection was made for, their live role, the connection and what it
 * holds — and null is answered: the request goes on. Anything else is the
 * response to send.
 */
export async function admitAgentBearer(
  c: Context<RestEnv>,
  bearer: string,
  clientIp: string,
  deps: AgentDoorDeps,
): Promise<Response | null> {
  const verdict = await verifyAgentAccessToken(bearer, {
    issuer: deps.issuer,
    resources: configuredMcpResources(),
    jwks: deps.jwks,
    cacheKey: deps.keyCache,
  });
  if (!verdict.ok) {
    // A token that merely ran out is the ordinary moment to refresh: only a
    // token that was never good is charged to its source.
    if (verdict.reason !== 'expired') {
      try {
        await checkIpRateLimit(deps.sql, 'rest:auth-fail-ip', clientIp);
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return restRateLimited(c, error);
        }
        throw error;
      }
    }
    return refusedToken(c, verdict.description);
  }
  const { token } = verdict;
  try {
    await checkUserRateLimit(deps.sql, 'rest:api', token.userId);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return restRateLimited(c, error);
    }
    throw error;
  }
  const seat = await findLiveConnectionSeat(deps.sql, {
    organizationId: token.organizationId,
    userId: token.userId,
    clientId: token.clientId,
  });
  if (seat === null || seat.createdAt > token.issuedAtMs + MINT_SKEW_MS) {
    return refusedToken(
      c,
      'This connection has ended; connect the agent again',
    );
  }
  const asked = c.req.header('x-organization-slug')?.toLowerCase();
  if (asked !== undefined && asked !== '' && asked !== seat.organizationSlug) {
    return c.json(
      {
        error: ONE_ORGANIZATION(seat.organizationSlug),
        code: 'ORG_MISMATCH',
        data: { organization: seat.organizationSlug },
      },
      403,
    );
  }
  c.set('userId', token.userId);
  c.set('userEmail', seat.email);
  c.set('organizationId', token.organizationId);
  c.set('orgSlug', seat.organizationSlug);
  c.set('role', seat.role);
  c.set('orgExplicit', true);
  c.set('clientIp', clientIp);
  c.set('apiKeyId', '');
  c.set('apiKeyOwner', null);
  c.set('agentConnection', {
    connectionId: seat.connectionId,
    clientId: token.clientId,
    clientName: seat.clientName,
    scopes: heldScopes(token.scopes, seat.scopes),
  });
  return null;
}
