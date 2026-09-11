import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
  codedAppError,
  type CodedRefusalStatus,
} from '../lib/app-error-response.ts';
import {
  rateLimitedResponse,
  rateLimitExceededCause,
} from '../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkUserRateLimit,
  type RateLimitName,
} from '../lib/rate-limit.ts';
import { isRestErrorCode } from './error-codes.ts';

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
  /** Why `readJsonBody` refused a body that parsed as JSON but carried a
   * value no field accepts (a U+0000) — `invalidBodyResponse` names it. */
  bodyIssue?: { path: string; message: string };
  /** The request id the app-level middleware stamped (`X-Request-Id`),
   * echoed by the door's JSON 500 so a caller can quote it. */
  requestId?: string;
}

export type RestEnv = { Variables: RestVars };

/** A route's own refusal: the documented status, the human message, and
 * the stable `code` a client branches on (every 4xx on this door carries
 * one, so a consumer never has to parse the sentence). */
export class RestRefusal extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409;
  readonly code: string | undefined;

  constructor(
    message: string,
    status: 400 | 401 | 403 | 404 | 409,
    code?: string,
  ) {
    super(message);
    this.name = 'RestRefusal';
    this.status = status;
    this.code = code;
  }
}

/** The 404 every family answers for a resource that is absent or invisible:
 * the flat envelope with a stable code, never a bare sentence. */
export function notFound(
  c: Context<RestEnv>,
  message: string,
  code: string,
): Response {
  return c.json({ error: message, code }, 404);
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

/** Codes a deeper layer answered that the registry does not carry — each
 * warned about once per process, so the registry (and with it the
 * published `Error.code` enum) is told what it is missing. */
const unregisteredCodes = new Set<string>();

export function noteRestErrorCode(code: string): void {
  if (isRestErrorCode(code) || unregisteredCodes.has(code)) return;
  unregisteredCodes.add(code);
  console.warn(
    `[rest] error code "${code}" is not registered in backend/rest/error-codes.ts — add it so the OpenAPI Error.code enum stays true`,
  );
}

/**
 * A coded `AppError` in the REST envelope — `{error: <sentence>, code}` at
 * the status the family's map gives its code. The app doors answer the
 * same errors as `{error: <code>, message}` (`appErrorResponse`); this
 * door documents one envelope, so it speaks one. Anything else is
 * rethrown for the door's 500.
 */
export function codedRefusalResponse(
  c: Context<RestEnv>,
  error: unknown,
  statusByCode: Readonly<Record<string, CodedRefusalStatus>>,
): Response {
  const coded = codedAppError(error);
  const status = coded === null ? undefined : statusByCode[coded.code];
  if (coded === null || status === undefined) throw error;
  noteRestErrorCode(coded.code);
  return c.json({ error: coded.message, code: coded.code }, status);
}

export function domainErrorResponse(
  c: Context<RestEnv>,
  error: unknown,
): Response {
  if (error instanceof RestRefusal) {
    if (error.code !== undefined) noteRestErrorCode(error.code);
    return c.json(
      {
        error: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
      },
      error.status,
    );
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
    noteRestErrorCode(error.code);
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
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch (error) {
    console.warn(
      '[rest] unparseable JSON body:',
      error instanceof Error ? error.message : String(error),
    );
    return INVALID_JSON;
  }
  return refuseNulBytes(c, parsed);
}

/**
 * The dotted path of the first string — a value or an object key — in a
 * parsed JSON body that carries a U+0000, or null when none does. Postgres
 * refuses a NUL in any text or jsonb value (`22021`), so a body that
 * carries one can never be stored; letting it reach the driver turned a
 * client mistake into a text/plain 500. Iterative, so a deeply nested body
 * cannot exhaust the stack.
 */
export function findNulByte(value: unknown): string | null {
  const stack: { value: unknown; path: string }[] = [{ value, path: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const current = item.value;
    if (typeof current === 'string') {
      if (current.includes('\0')) return item.path;
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current[index],
          path: item.path === '' ? String(index) : `${item.path}.${index}`,
        });
      }
      continue;
    }
    if (current !== null && typeof current === 'object') {
      const entries = Object.entries(current);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const [key, child] = entry;
        const path = item.path === '' ? key : `${item.path}.${key}`;
        if (key.includes('\0')) return path;
        stack.push({ value: child, path });
      }
    }
  }
  return null;
}

/** A parsed body that carries a NUL anywhere reads as `INVALID_JSON`, with
 * the offending path recorded for `invalidBodyResponse` to name. */
function refuseNulBytes(c: Context<RestEnv>, parsed: unknown): unknown {
  const path = findNulByte(parsed);
  if (path === null) return parsed;
  c.set('bodyIssue', {
    path,
    message: 'must not contain a NUL character (U+0000)',
  });
  return INVALID_JSON;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      '[rest] unparseable JSON body:',
      error instanceof Error ? error.message : String(error),
    );
    return INVALID_JSON;
  }
  return refuseNulBytes(c, parsed);
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
    ? [
        c.get('bodyIssue') ?? {
          path: '',
          message: 'The body is not valid JSON',
        },
      ]
    : error.issues
        .flatMap((issue) =>
          // zod reports every unknown key of an object as ONE issue at the
          // object's path; the envelope names each key as its own problem,
          // so a client can fix what it named rather than search a list.
          issue.code === 'unrecognized_keys'
            ? issue.keys.map((key) => ({
                path: [...issue.path.map(String), key].join('.'),
                message: 'is not a field this body takes',
              }))
            : [
                {
                  path: issue.path.map(String).join('.'),
                  message: issue.message,
                },
              ],
        )
        .slice(0, MAX_BODY_ISSUES);
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
      'ROLE_FORBIDDEN',
    );
  }
}

/** The org editor gate — the set the session project mutations admit. */
export function requireEditor(c: Context<RestEnv>): void {
  if (!EDITOR_ROLES.has(c.get('role'))) {
    throw new RestRefusal(
      `Role "${c.get('role')}" cannot modify this resource.`,
      403,
      'ROLE_FORBIDDEN',
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

/** The 400 for a query parameter a list cannot act on: the stable code,
 * the sentence, and — when a schema refused it — every problem under
 * `data.issues`, the same shape `invalidBodyResponse` gives a body. */
export function invalidQueryResponse(
  c: Context<RestEnv>,
  code: 'INVALID_CURSOR' | 'INVALID_LIMIT' | 'INVALID_QUERY',
  message: string,
  issues?: { path: string; message: string }[],
): Response {
  return c.json(
    {
      error: message,
      code,
      ...(issues === undefined ? {} : { data: { issues } }),
    },
    400,
  );
}

/** The 400 for a query string a zod schema refused (`INVALID_QUERY`), every
 * problem named by parameter — the query-side twin of `invalidBodyResponse`. */
export function invalidQueryFromSchema(
  c: Context<RestEnv>,
  error: ZodError,
): Response {
  const issues = error.issues.slice(0, MAX_BODY_ISSUES).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  const first = issues[0] ?? { path: '', message: 'does not match the schema' };
  return invalidQueryResponse(
    c,
    'INVALID_QUERY',
    first.path === ''
      ? `invalid query: ${first.message}`
      : `invalid query: "${first.path}" ${first.message}`,
    issues,
  );
}

const CURSOR_MESSAGE =
  'The "cursor" query parameter is not a cursor this list answered — pass the cursor the previous page answered, unchanged, or omit it for the first page';

/**
 * Page cursors are SIGNED: `<position>.<tag>`, the tag an HMAC over the
 * list's scope (its name and the organization) and the position. A
 * consumer passes `continueCursor` back unchanged, so the format is opaque
 * to it — and a token this list never answered (a synthesised position,
 * another list's or another organization's cursor, a hand-edited one) is
 * refused with `INVALID_CURSOR` instead of being executed as a position:
 * a well-formed but fabricated keyset cursor used to read as page one, the
 * silent restart the API reference promises never happens.
 *
 * The key derives from the deployment's `INSTANCE_SECRET` (the same root
 * as the WebDAV app-password key, so every replica of a colour and both
 * colours of a rollout agree), else from `BETTER_AUTH_SECRET`; a bare dev
 * process with neither signs with a public constant — cursors are
 * positions, not credentials, so the constant costs nothing but provenance.
 */
const CURSOR_TAG_BYTES = 16;
let cursorKeyCache: Buffer | null = null;

function cursorKey(): Buffer {
  if (cursorKeyCache !== null) return cursorKeyCache;
  const root =
    process.env.INSTANCE_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    'tale-dev-cursor-key';
  cursorKeyCache = createHash('sha256')
    .update(`${root}:rest-cursor:v1`)
    .digest();
  return cursorKeyCache;
}

/** Test seam: forget the derived key so a changed secret is picked up. */
export function resetCursorKeyForTests(): void {
  cursorKeyCache = null;
}

function cursorTag(scope: string, position: string): string {
  return createHmac('sha256', cursorKey())
    .update(`${scope}\n${position}`)
    .digest()
    .subarray(0, CURSOR_TAG_BYTES)
    .toString('base64url');
}

/** The signed cursor of `list` in `organizationId` for `position` — the
 * context-free form the routes' `mintCursor` and the tests share. */
export function mintCursorFor(
  organizationId: string,
  list: string,
  position: string,
): string {
  return `${position}.${cursorTag(`${list}:${organizationId}`, position)}`;
}

/** The position inside a cursor `list` in `organizationId` answered, or
 * null for a token that is not one of its own (constant-time comparison). */
export function verifyCursorFor(
  organizationId: string,
  list: string,
  token: string,
): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const position = token.slice(0, dot);
  const tag = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(
    cursorTag(`${list}:${organizationId}`, position),
  );
  return tag.length === expected.length && timingSafeEqual(tag, expected)
    ? position
    : null;
}

/** The signed `continueCursor` a list answers for `position` (a keyset
 * `formatKeysetCursor` token or a whole number as text). `list` names the
 * list — with the project id for a project-scoped one (`files:<id>`) — so
 * the cursor redeems only there. */
export function mintCursor(
  c: Context<RestEnv>,
  list: string,
  position: string,
): string {
  return mintCursorFor(c.get('organizationId'), list, position);
}

/** The position inside a signed cursor this list answered, or null. */
export function verifyCursor(
  c: Context<RestEnv>,
  list: string,
  token: string,
): string | null {
  return verifyCursorFor(c.get('organizationId'), list, token);
}

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
  list: string,
): { at: number; id: string } | null | Response {
  const raw = c.req.query('cursor');
  if (raw === undefined || raw === '') return null;
  const position = verifyCursor(c, list, raw);
  return (
    (position === null ? null : parseKeysetCursor(position)) ??
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
  list: string,
  bounds: { max?: number } = {},
): number | null | Response {
  const raw = c.req.query('cursor');
  if (raw === undefined || raw.trim() === '') return null;
  const position = verifyCursor(c, list, raw);
  const parsed = position === null ? Number.NaN : Number(position);
  return /^\d{1,15}$/.test(position ?? '') &&
    Number.isInteger(parsed) &&
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
  // A blank `limit=` is an absent one — `Number('')` is 0, which floored to
  // a single row and silently answered one-row pages.
  const absent =
    raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  const parsed = absent ? defaults.fallback : Number(raw);
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
      throw new RestRefusal('Project not found', 404, 'PROJECT_NOT_FOUND');
    }
    throw error;
  }
  if (options.write) assertWritable(project, auth);
  if ((options.write || options.active) && project.archivedAt !== null) {
    throw new RestRefusal('Project is archived', 403, 'PROJECT_ARCHIVED');
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
