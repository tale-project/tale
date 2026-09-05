import type { Context } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import { EDITOR_ROLES } from '../core/projects/access.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import { getProjectAuthContext } from '../domains/projects/service.ts';
import {
  rateLimitedResponse,
  rateLimitExceededCause,
} from '../lib/rate-limit-response.ts';
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
export function isDomainError(
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
  // A domain wrapper around a spent budget (a `DocumentError` coded
  // `RATE_LIMITED`) answers the one 429 every door speaks, `Retry-After`
  // included, rather than a coded 429 without the wait.
  const limited = rateLimitExceededCause(error);
  if (limited !== null) {
    return rateLimitedResponse(c, limited);
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

/** What `readJsonBody` answers for a body that is not JSON — a sentinel no
 * schema accepts, so `safeParse` refuses it like any other malformed body. */
export const INVALID_JSON: unique symbol = Symbol('invalid-json');

/**
 * The request body as JSON, or `INVALID_JSON` when it does not parse (an
 * empty body, a truncated `curl -d`). Hono's `c.req.json()` is a bare
 * `JSON.parse`, and a SyntaxError left to the app-level handler reads as a
 * 500 outage and lands in error reporting — a client mistake belongs in the
 * documented 400 envelope instead.
 */
export async function readJsonBody(c: Context<RestEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    console.warn(
      '[rest] unparseable JSON body:',
      error instanceof Error ? error.message : String(error),
    );
    return INVALID_JSON;
  }
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
    // The domain's own status (400 slug required, 403 foreign, 404 unknown);
    // anything else — a driver failure — is an outage, not a client mistake.
    return domainErrorResponse(c, error);
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
      return rateLimitedResponse(c, error);
    }
    throw error;
  }
}

/**
 * The keyset cursor the paginated families exchange: `<timestamp>:<id>` —
 * the previous page's last row, opaque to the consumer (the spec says
 * "pass `continueCursor` back as `cursor`"). One codec for every list that
 * orders on `(<ts>_ms DESC, id DESC)`, so no family invents its own format.
 */
export function formatKeysetCursor(at: number, id: string): string {
  return `${at}:${id}`;
}

/** The inverse of `formatKeysetCursor`; anything unparseable reads as "no
 * cursor" (the first page) rather than a 400 — an opaque token has no
 * shape a consumer could have gotten wrong on purpose. */
export function parseKeysetCursor(
  raw: string | null | undefined,
): { at: number; id: string } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const split = raw.indexOf(':');
  if (split <= 0 || split === raw.length - 1) return null;
  const at = Number(raw.slice(0, split));
  return Number.isFinite(at) ? { at, id: raw.slice(split + 1) } : null;
}

/** The page size a list route honours: the documented default, truncated
 * to a whole row (the driver ships a JS number as text, so `2.5` is an
 * `int8in` error), floored at one row (a negative `LIMIT` is a Postgres
 * error, zero a dead page) and capped at `max`. Takes the query string or
 * an already-numeric body field. */
export function pageLimit(
  raw: string | number | undefined,
  defaults: { fallback: number; max: number },
): number {
  const parsed = Number(raw ?? String(defaults.fallback));
  const limit = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : defaults.fallback;
  return Math.min(Math.max(limit, 1), defaults.max);
}

/** The minting user's project-auth context (visibility matrix). */
export async function restProjectAuth(sql: Sql, c: Context<RestEnv>) {
  return getProjectAuthContext(sql, {
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });
}
