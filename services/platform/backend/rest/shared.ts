import type { Context } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import { EDITOR_ROLES } from '../core/projects/access.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import { getProjectAuthContext } from '../domains/projects/service.ts';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';

/**
 * Shared plumbing of the `/api/v1` REST families: the request variables the
 * door middleware (v1.ts) sets, the coded-refusal error type, the domain-
 * error → HTTP mapping, and the capability/lane helpers the 0.4 handlers
 * applied per route.
 */

export interface RestVars {
  userId: string;
  userEmail: string;
  organizationId: string;
  orgSlug: string;
  role: string;
  /** Whether the caller NAMED the org (`X-Organization-Slug`). */
  orgExplicit: boolean;
  /** The trusted-proxy-derived client IP (the door's pre-auth limiter key;
   * kept for attribution — authenticated budgets key on the user). */
  clientIp: string;
}

export type RestEnv = { Variables: RestVars };

export class RestRefusal extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 401 | 403 | 404 | 409) {
    super(message);
    this.name = 'RestRefusal';
    this.status = status;
  }
}

/** The `{code, 4xx status}` shape every domain error class carries. */
function isDomainError(
  error: unknown,
): error is Error & { code: string; status: number } {
  if (!(error instanceof Error)) return false;
  const code: unknown = Reflect.get(error, 'code');
  const status: unknown = Reflect.get(error, 'status');
  return (
    typeof code === 'string' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}

export function domainErrorResponse(
  c: Context<RestEnv>,
  error: unknown,
): Response {
  if (error instanceof RestRefusal) {
    return c.json({ error: error.message }, error.status);
  }
  if (isDomainError(error)) {
    // Every domain error carries a client-mappable status; NOT_FOUND-ish
    // codes read as 404 rather than leaking existence semantics.
    return c.json(
      { error: error.message, code: error.code },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- isDomainError pinned the closed 4xx set
      error.status as 400,
    );
  }
  throw error;
}

/**
 * The developer capability gate — authoring a trigger, starting a LIVE run,
 * cancelling a run (the same rule the session surface applies).
 */
export function requireDeveloper(c: Context<RestEnv>): void {
  if (defineAbilityFor(c.get('role')).cannot('read', 'developerSettings')) {
    throw new RestRefusal(
      `Role "${c.get('role')}" lacks the developer capability required here.`,
      403,
    );
  }
}

/** The org editor gate — the set the session project mutations admit. */
export function requireEditor(c: Context<RestEnv>): void {
  if (!EDITOR_ROLES.has(c.get('role'))) {
    throw new RestRefusal(
      `Role "${c.get('role')}" cannot modify this resource.`,
      403,
    );
  }
}

/**
 * Strict-org re-check for the write-shaped GET families (tasks, projects):
 * a multi-org key must NAME its organization even on reads there — the 0.4
 * `requireExplicitOrgSlug` posture. A single-org key passes without the
 * header (its one org is unambiguous).
 */
export async function assertExplicitOrg(
  sql: Sql,
  c: Context<RestEnv>,
): Promise<Response | null> {
  if (c.get('orgExplicit')) return null;
  try {
    await resolveUserOrganization(sql, {
      userId: c.get('userId'),
      requireExplicitOrgSlug: true,
    });
    return null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Organization is ambiguous';
    return c.json({ error: message }, 400);
  }
}

/**
 * Top-up charge on a second rate lane (`rest:execute`, `rest:upload`) so a
 * route's effective budget is the tighter of its lanes. Keyed like the
 * door's `rest:api` charge — on the key holder (the key acts as its user),
 * so the budget is attributable and no header can mint a fresh one.
 */
export async function chargeLane(
  sql: Sql,
  c: Context<RestEnv>,
  rule: 'rest:api' | 'rest:execute' | 'rest:upload',
): Promise<Response | null> {
  try {
    await checkUserRateLimit(sql, rule, c.get('userId'));
    return null;
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return c.json({ error: 'Rate limit exceeded' }, 429, {
        'retry-after': String(Math.ceil(error.retryAfter / 1000)),
      });
    }
    throw error;
  }
}

/** The minting user's project-auth context (visibility matrix). */
export async function restProjectAuth(sql: Sql, c: Context<RestEnv>) {
  return getProjectAuthContext(sql, {
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });
}
