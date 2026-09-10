import type { Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import type { ZodError } from 'zod';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import { EDITOR_ROLES } from '../core/projects/access.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import {
  assertReadable,
  assertWritable,
  getProjectAuthContext,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
  type ProjectRow,
} from '../domains/projects/service.ts';
import {
  rateLimitedResponse,
  rateLimitExceededCause,
} from '../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkUserRateLimit,
  type RateLimitName,
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
 * The body of a route whose body is OPTIONAL: nothing sent (or whitespace)
 * reads as `{}`, a body that is present but not JSON reads as
 * `INVALID_JSON`. The former `c.req.json().catch(() => ({}))` treated a
 * truncated `curl -d` like no body at all — a broken JSON document started a
 * live run with `{}` as its input instead of the documented 400.
 */
export async function readOptionalJsonBody(
  c: Context<RestEnv>,
): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.warn(
      '[rest] unparseable JSON body:',
      error instanceof Error ? error.message : String(error),
    );
    return INVALID_JSON;
  }
}

/** How many schema problems one 400 lists — enough to fix a body in one
 * round trip, bounded so a hostile body cannot echo itself back at length. */
const MAX_BODY_ISSUES = 20;

/**
 * The 400 for a body a route's schema refused: the first problem, named by
 * path and reason, in the envelope's `error`; the stable `INVALID_BODY`
 * code; and every problem under `data.issues`. A fixed sentence per route
 * ("name is required") blamed a field the caller HAD sent whenever the real
 * problem was another field's type or an unknown key — a consumer following
 * that hint could never fix the body.
 */
export function invalidBodyResponse(
  c: Context<RestEnv>,
  error: ZodError,
): Response {
  // `readJsonBody` answers a body that is not JSON with a symbol no schema
  // accepts; zod reports that as a type mismatch at the root, which is not
  // what the caller needs to hear.
  const notJson = error.issues.some(
    (issue) =>
      issue.path.length === 0 &&
      issue.code === 'invalid_type' &&
      issue.message.endsWith('received symbol'),
  );
  const issues = notJson
    ? [{ path: '', message: 'The body is not valid JSON' }]
    : error.issues.slice(0, MAX_BODY_ISSUES).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
  const first = issues[0] ?? {
    path: '',
    message: 'does not match the schema',
  };
  return c.json(
    {
      error:
        first.path === ''
          ? `invalid body: ${first.message}`
          : `invalid body: "${first.path}" ${first.message}`,
      code: 'INVALID_BODY',
      data: { issues },
    },
    400,
  );
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
 * Top-up charge on a second rate lane (`rest:execute`, `rest:upload`) — or
 * on the per-user budget a write's in-app twin passes (`task:comment`) —
 * so a route's effective budget is the tighter of its lanes. Keyed like the
 * door's `rest:api` charge — on the key holder (the key acts as its user),
 * so the budget is attributable and no header can mint a fresh one.
 */
export async function chargeLane(
  sql: Sql,
  c: Context<RestEnv>,
  rule: RateLimitName,
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

/** The inverse of `formatKeysetCursor`: the decoded position, or null for
 * nothing / an empty string / a token that is not one of ours. The REST
 * doors read it through `readKeysetCursor`, which turns the last case into
 * a 400 — this codec itself stays lenient for callers that hold a cursor a
 * service decoded for them. */
export function parseKeysetCursor(
  raw: string | null | undefined,
): { at: number; id: string } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const split = raw.indexOf(':');
  if (split <= 0 || split === raw.length - 1) return null;
  // The encoder writes a whole epoch-millisecond count. A fraction, an
  // exponent or a count the bigint column cannot hold is not a token this
  // list answered — and reaches Postgres as a cast error (22P02 / 22003),
  // a 500, when it is let through as a finite number.
  const stamp = raw.slice(0, split);
  if (!/^\d{1,15}$/.test(stamp)) return null;
  const at = Number(stamp);
  return Number.isSafeInteger(at) ? { at, id: raw.slice(split + 1) } : null;
}

/** The 400 for a query parameter a list cannot act on. */
function invalidQueryResponse(
  c: Context<RestEnv>,
  code: 'INVALID_CURSOR' | 'INVALID_LIMIT',
  message: string,
): Response {
  return c.json({ error: message, code }, 400);
}

const CURSOR_MESSAGE =
  'The "cursor" query parameter is not a cursor this list answered — pass the cursor the previous page answered, unchanged, or omit it for the first page';

/**
 * The `cursor` query of a keyset-paginated list: null for the first page
 * (absent or empty), the decoded position, or the 400 a token that is not
 * one of ours answers. A mangled or truncated cursor used to read as "no
 * cursor" and silently restart from page one — a consumer walking a list
 * incrementally re-processed the first page without any signal that its
 * position was lost. (`INVALID_CURSOR`)
 */
export function readKeysetCursor(
  c: Context<RestEnv>,
): { at: number; id: string } | null | Response {
  const raw = c.req.query('cursor');
  if (raw === undefined || raw === '') return null;
  return (
    parseKeysetCursor(raw) ??
    invalidQueryResponse(c, 'INVALID_CURSOR', CURSOR_MESSAGE)
  );
}

/**
 * The `cursor` query of a list whose position is one whole number (a
 * message order, an entry sequence): null for the first page, the number,
 * or the 400 for anything else — the same posture as `readKeysetCursor`.
 */
export function readIntegerCursor(
  c: Context<RestEnv>,
  bounds: { max?: number } = {},
): number | null | Response {
  const raw = c.req.query('cursor');
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= (bounds.max ?? Number.MAX_SAFE_INTEGER)
    ? parsed
    : invalidQueryResponse(c, 'INVALID_CURSOR', CURSOR_MESSAGE);
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

/**
 * The `limit` query of a list route: `pageLimit`'s clamping for a number
 * (the documented "out-of-range values are clamped"), the 400 for a value
 * that is not a number at all — `limit=abc` used to read as the default
 * page size with nothing telling the caller. (`INVALID_LIMIT`)
 */
export function readPageLimit(
  c: Context<RestEnv>,
  defaults: { fallback: number; max: number },
): number | Response {
  const raw = c.req.query('limit');
  if (raw !== undefined && raw.trim() !== '' && !Number.isFinite(Number(raw))) {
    return invalidQueryResponse(
      c,
      'INVALID_LIMIT',
      `The "limit" query parameter must be a whole number (1..${defaults.max})`,
    );
  }
  return pageLimit(raw, defaults);
}

/** The minting user's project-auth context (visibility matrix). */
export async function restProjectAuth(sql: Sql, c: Context<RestEnv>) {
  return getProjectAuthContext(sql, {
    organizationId: c.get('organizationId'),
    userId: c.get('userId'),
    role: c.get('role'),
  });
}

/** The URL project is authoritative for every nested REST resource. Hidden
 * projects are opaque; driver failures remain outages. Member collaboration
 * requires an active readable project, while editorial writes also require
 * edit access. Call inside a mutation's transaction to recheck its scope. */
export async function loadRestProject(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
  options: { write?: boolean; active?: boolean } = {},
): Promise<ProjectRow> {
  let project: ProjectRow;
  try {
    project = await loadProjectOrThrow(sql, projectId);
    assertReadable(project, auth);
  } catch (error) {
    if (
      error instanceof ProjectError &&
      (error.code === 'PROJECT_NOT_FOUND' || error.code === 'PROJECT_FORBIDDEN')
    ) {
      throw new RestRefusal('Project not found', 404);
    }
    throw error;
  }
  if (options.write) assertWritable(project, auth);
  if ((options.write || options.active) && project.archivedAt !== null) {
    throw new RestRefusal('Project is archived', 403);
  }
  return project;
}

/** Keep the project editable until the caller's transaction commits, including
 * while a file write waits for blob storage. A serializable retry would repeat
 * that external I/O; a row lock instead orders archival and binding. */
export async function lockRestProjectForWrite(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectRow> {
  await tx`
    SELECT id FROM app.projects
    WHERE id = ${projectId} AND org_id = ${auth.organizationId}
    FOR SHARE
  `;
  return loadRestProject(tx, auth, projectId, { write: true });
}
