import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z, type ZodError } from 'zod';

import { defineAbilityFor } from '../../lib/permissions/ability.ts';
import { attachmentDisposition } from '../../lib/shared/http/content-disposition.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import { EDITOR_ROLES } from '../core/projects/access.ts';
import {
  DocumentError,
  type DocumentRow,
} from '../domains/documents/service.ts';
import {
  type FileContent,
  FileError,
  openFileContent,
} from '../domains/files/service.ts';
import {
  assertReadable,
  assertWritable,
  getProjectAuthContext,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
  type ProjectRow,
} from '../domains/projects/service.ts';
import { PurgeIncompleteError } from '../domains/retention/service.ts';
import {
  codedAppError,
  type CodedRefusalStatus,
} from '../lib/app-error-response.ts';
import { entityTagOf, ifNoneMatchMatches } from '../lib/conditional-get.ts';
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
  /** Whether the caller NAMED the org (`X-Organization-Slug`) — informational:
   * the door itself demands the header of every multi-org key, on every
   * route, so no family re-checks it. */
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

/**
 * The refusals every door that hard-deletes documents shares — the Hub
 * delete, a project file's delete, a project folder's cascade: a protected
 * record is the documented 409 in the door's own envelope, and a purge that
 * could not remove every dead surface is the 503 the row was kept for (the
 * delete can be retried), never the bare 500 an unmapped error becomes.
 * Everything else is the ordinary domain mapping (a legal hold's 409, a
 * missing row's 404).
 */
export function documentDeleteRefusal(
  c: Context<RestEnv>,
  error: unknown,
): Response {
  if (
    error instanceof DocumentError &&
    error.code === 'DOCUMENT_RECORD_PROTECTED'
  ) {
    return c.json({ error: error.message, code: error.code }, 409);
  }
  if (error instanceof PurgeIncompleteError) {
    noteRestErrorCode(error.code);
    return c.json({ error: error.message, code: error.code }, 503);
  }
  return domainErrorResponse(c, error);
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
  const message = `[rest] error code "${code}" is not registered in backend/rest/error-codes.ts — add it so the OpenAPI Error.code enum stays true`;
  // The integration check runs strict: a code the registry does not carry
  // fails the lane that provoked it, instead of a warning nobody reads
  // until a client branches on a value the contract never named.
  if (process.env.TALE_STRICT_ERROR_CODES === '1') throw new Error(message);
  console.warn(message);
}

/**
 * A coded `AppError` in the REST envelope — `{error: <sentence>, code}` at
 * the status the family's map gives its code, with the refusal's own
 * `data` handed on when it carries one (a failed precondition names the
 * current entity tag there), as `domainErrorResponse` does for the domain
 * error classes. The app doors answer the same errors as `{error: <code>,
 * message}` (`appErrorResponse`); this door documents one envelope, so it
 * speaks one. Anything else is rethrown for the door's 500.
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
  return c.json(
    {
      error: coded.message,
      code: coded.code,
      ...(coded.data === undefined ? {} : { data: coded.data }),
    },
    status,
  );
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
    // codes read as 404 rather than leaking existence semantics. A domain
    // refusal that carries structured `data` (the schema problems of a
    // refused run input, the candidates of an ambiguous match) hands it on
    // — the sentence alone told a client that something was wrong, never
    // what.
    noteRestErrorCode(error.code);
    return c.json(
      { error: error.message, code: error.code, ...domainErrorData(error) },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- isDomainError pinned the closed 4xx set
      error.status as 400,
    );
  }
  throw error;
}

/** The `{data}` a domain error carries, when it is a plain object. */
function domainErrorData(error: Error): { data?: Record<string, unknown> } {
  const data: unknown = Reflect.get(error, 'data');
  return isRecord(data) ? { data } : {};
}

/** What `readJsonBody` answers for a body that is not JSON — a sentinel no
 * schema accepts, so `safeParse` refuses it like any other malformed body. */
export const INVALID_JSON: unique symbol = Symbol('invalid-json');

/** The sentence a body that is not JSON answers, whatever schema refused
 * the sentinel `readJsonBody` handed it. */
const NOT_JSON_MESSAGE = 'The body is not valid JSON';

/**
 * The byte cap every JSON body on this door gets unless its route asks for
 * a larger one (`readJsonBody(c, {maxBytes})`): the routes' own field caps
 * (a 5,000,000-character document, a 500-row bulk create) are checked only
 * after zod has the whole body, so without a byte cap every route buffered
 * an unbounded body in the heap first — and a body that could never be
 * accepted was refused only after it had all arrived. Refused as the 413
 * the door's error handler answers as `BODY_TOO_LARGE`.
 */
export const DEFAULT_BODY_BYTES = 1024 * 1024;

/** A byte count the way the docs write it: whole MiB above a mebibyte,
 * KiB below. */
function describeByteCap(maxBytes: number): string {
  return maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0
    ? `${maxBytes / (1024 * 1024)} MiB`
    : `${Math.round(maxBytes / 1024)} KiB`;
}

/**
 * The 413 every oversized body on this door answers (`BODY_TOO_LARGE`
 * through the door's error handler), naming the cap the route holds it to
 * — the caps differ per operation (1 MiB by default, 4 MiB for a skill,
 * 8 MiB for a snapshot), and a refusal that says only "Request refused"
 * sends the caller to the documentation for a number the door knows.
 */
export function bodyTooLarge(maxBytes: number): HTTPException {
  return new HTTPException(413, {
    message: `Request body exceeds the ${describeByteCap(maxBytes)} limit of this route`,
  });
}

/**
 * The byte cap for a route whose handler reads the body itself (the MCP
 * endpoint, a delivery claim): hono's `bodyLimit` with the door's own
 * refusal, so the 413 names the cap like `readJsonBody`'s does instead of
 * the middleware's bare "Payload Too Large" — which the door's handler
 * could only render as "Request refused".
 */
export function restBodyLimit(maxBytes: number): MiddlewareHandler<RestEnv> {
  return bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw bodyTooLarge(maxBytes);
    },
  });
}

/** The bounded body read behind `readJsonBody`: the declared length is
 * refused before a byte is read, the bytes actually received are counted
 * as they arrive, and the read stops at the first chunk past the cap. */
async function readBodyBytes(
  c: Context<RestEnv>,
  maxBytes: number,
): Promise<Uint8Array> {
  const tooLarge = () => bodyTooLarge(maxBytes);
  const declared = Number(c.req.header('content-length') ?? '');
  if (Number.isSafeInteger(declared) && declared > maxBytes) {
    await c.req.raw.body?.cancel().catch((error: unknown) => {
      console.warn('[rest] cancelling an oversized body failed:', error);
    });
    throw tooLarge();
  }
  const body = c.req.raw.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch((error: unknown) => {
          console.warn('[rest] cancelling an oversized body failed:', error);
        });
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * The request body as text, decoded STRICTLY as UTF-8: a byte sequence that
 * is not UTF-8 is refused rather than repaired. The Fetch decoders behind
 * `c.req.json()` / `c.req.text()` replace a malformed sequence with U+FFFD,
 * so a body sent in another encoding parsed, validated and was stored with
 * replacement characters in place of the caller's text — a silent
 * alteration, where a NUL in the same body is refused outright. Null when
 * the bytes are not UTF-8, the issue recorded for `invalidBodyResponse`.
 */
async function readUtf8Body(
  c: Context<RestEnv>,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readBodyBytes(c, maxBytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    console.warn(
      '[rest] body is not valid UTF-8:',
      error instanceof Error ? error.message : String(error),
    );
    c.set('bodyIssue', { path: '', message: 'The body is not valid UTF-8' });
    return null;
  }
}

/** Thrown by `parseJsonExactly` for a number the parser had to round. */
class InexactNumberError extends Error {
  constructor(readonly key: string) {
    super(`"${key}" is a whole number beyond 2^53 − 1`);
    this.name = 'InexactNumberError';
  }
}

/**
 * `JSON.parse` that refuses what it cannot carry: a whole number beyond
 * ±(2^53 − 1) is rounded by the parser before any schema sees it, so a
 * source system's 64-bit id arrived silently altered and was stored that
 * way. The reviver reads the literal's own source text (Node 22) and
 * refuses when the parsed value no longer prints as it — the issue is
 * recorded for `invalidBodyResponse`, keyed by the field name.
 */
function parseJsonExactly(c: Context<RestEnv>, raw: string): unknown {
  const reviver = (
    key: string,
    value: unknown,
    context?: { source?: string },
  ): unknown => {
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      !Number.isSafeInteger(value) &&
      typeof context?.source === 'string' &&
      /^-?\d+$/.test(context.source)
    ) {
      throw new InexactNumberError(key);
    }
    return value;
  };
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the lib typing predates the reviver's source-text context
    return JSON.parse(raw, reviver as Parameters<typeof JSON.parse>[1]);
  } catch (error) {
    if (error instanceof InexactNumberError) {
      c.set('bodyIssue', {
        path: error.key,
        message:
          'is a whole number beyond 2^53 − 1, which cannot be carried exactly; send it as a string',
      });
    }
    throw error;
  }
}

/**
 * The request body as JSON, or `INVALID_JSON` when it does not parse (an
 * empty body, a truncated `curl -d`) or is not UTF-8. Hono's `c.req.json()`
 * is a bare `JSON.parse`, and a SyntaxError left to the app-level handler
 * reads as a 500 outage and lands in error reporting — a client mistake
 * belongs in the documented 400 envelope instead.
 */
export async function readJsonBody(
  c: Context<RestEnv>,
  options: { maxBytes?: number } = {},
): Promise<unknown> {
  const raw = await readUtf8Body(c, options.maxBytes ?? DEFAULT_BODY_BYTES);
  if (raw === null) return INVALID_JSON;
  let parsed: unknown;
  try {
    parsed = parseJsonExactly(c, raw);
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
  options: { maxBytes?: number } = {},
): Promise<unknown> {
  const raw = await readUtf8Body(c, options.maxBytes ?? DEFAULT_BODY_BYTES);
  if (raw === null) return INVALID_JSON;
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = parseJsonExactly(c, raw);
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

/** zod's `expected` vocabulary, said the way the rest of the envelope
 * speaks ("must be a whole number"), never the validator's own dialect. */
function describeExpectedType(expected: string): string {
  switch (expected) {
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'int':
    case 'bigint':
      return 'a whole number';
    case 'boolean':
      return 'a boolean';
    case 'object':
      return 'an object';
    case 'array':
      return 'an array';
    case 'null':
      return 'null';
    case 'date':
      return 'a date';
    default:
      return expected;
  }
}

function describeQuantity(origin: string | undefined, count: unknown): string {
  const n = String(count);
  switch (origin) {
    case 'string':
      return `${n} character${n === '1' ? '' : 's'}`;
    case 'array':
    case 'set':
      return `${n} item${n === '1' ? '' : 's'}`;
    default:
      return n;
  }
}

function quoteValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * The reason a schema refusal states, in the house voice, for every zod
 * issue a body or query can raise: "is required", "must be a string",
 * "must not be blank", "must be at most 200 characters", "must be one of
 * "a", "b"" — short phrases a consumer can show a person. Passed to every
 * parse on this door as the per-parse error map, which zod 4 consults
 * AFTER a schema's own message (`nonBlank`'s "must not be blank", a
 * route's `.regex(…, { message })`) and BEFORE its locale text, so the
 * validator's dialect ("Invalid input: expected string, received number",
 * "Too small: expected string to have >=1 characters") never reaches the
 * wire, and a message a client happens to match on stays ours to keep.
 */
export function houseIssueMessage(
  issue: z.core.$ZodRawIssue,
): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return 'is required';
      // `readJsonBody` answers a body that is not JSON with a symbol no
      // schema accepts (`INVALID_JSON`).
      if (typeof issue.input === 'symbol') return NOT_JSON_MESSAGE;
      return `must be ${describeExpectedType(issue.expected)}`;
    case 'invalid_value': {
      // An absent enum field is "required", not a wrong option.
      if (issue.input === undefined) return 'is required';
      const values = issue.values.map(quoteValue);
      return values.length === 1
        ? `must be ${values[0]}`
        : `must be one of ${values.join(', ')}`;
    }
    case 'too_small': {
      const inclusive = issue.inclusive !== false;
      if (
        issue.origin === 'string' &&
        Number(issue.minimum) === 1 &&
        inclusive
      ) {
        return 'must not be blank';
      }
      const quantity = describeQuantity(issue.origin, issue.minimum);
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `must have at least ${quantity}`;
      }
      return inclusive
        ? `must be at least ${quantity}`
        : `must be greater than ${quantity}`;
    }
    case 'too_big': {
      const inclusive = issue.inclusive !== false;
      const quantity = describeQuantity(issue.origin, issue.maximum);
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `must have at most ${quantity}`;
      }
      return inclusive
        ? `must be at most ${quantity}`
        : `must be less than ${quantity}`;
    }
    case 'invalid_format':
      switch (issue.format) {
        case 'email':
          return 'must be an email address';
        case 'url':
          return 'must be an absolute URL';
        case 'uuid':
          return 'must be a UUID';
        case 'regex':
          return issue.pattern === undefined
            ? 'must match the required pattern'
            : `must match ${issue.pattern}`;
        default:
          return `must be a valid ${issue.format}`;
      }
    case 'not_multiple_of':
      return `must be a multiple of ${String(issue.divisor)}`;
    case 'invalid_union':
      return issue.input === undefined
        ? 'is required'
        : 'does not match any accepted shape';
    default:
      // `unrecognized_keys` is spelled out per key by `schemaIssues`; a
      // `custom` refinement carries its own sentence.
      return undefined;
  }
}

/** The `{path, message}` list a schema refusal answers under `data.issues`.
 * zod reports every unknown key of an object as ONE issue at the object's
 * path; the envelope names each key as its own problem (`unknownKey` is its
 * message), so a client can fix what it named rather than search a list. */
function schemaIssues(
  error: ZodError,
  unknownKey: string,
): { path: string; message: string }[] {
  return error.issues
    .flatMap((issue) =>
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => ({
            path: [...issue.path.map(String), key].join('.'),
            message: unknownKey,
          }))
        : [
            {
              path: issue.path.map(String).join('.'),
              // A required field that was not sent is "required", not a
              // type mismatch with `undefined`: `houseIssueMessage` says
              // so for every parse on this door, and a parse that skipped
              // it still gets zod's default text rewritten here. A
              // schema's own sentence for an absent field (the model
              // field's pointer to the catalog) is kept as written.
              message:
                issue.path.length > 0 &&
                issue.message.endsWith('received undefined')
                  ? 'is required'
                  : issue.message,
            },
          ],
    )
    .slice(0, MAX_BODY_ISSUES);
}

/**
 * The route's body, parsed and validated in one step: the JSON (strict
 * UTF-8, bounded, NUL-free) against `schema`, or the 400 `INVALID_BODY`
 * envelope naming every problem — with a field that was not sent named
 * as "is required" rather than as a type mismatch. The one call every
 * write on the door should make instead of `readJsonBody` + `safeParse` +
 * `invalidBodyResponse` by hand.
 */
export async function parseBody<Schema extends z.ZodType>(
  c: Context<RestEnv>,
  schema: Schema,
  options: { maxBytes?: number; optional?: boolean } = {},
): Promise<z.output<Schema> | Response> {
  const body = options.optional
    ? await readOptionalJsonBody(c, options)
    : await readJsonBody(c, options);
  const parsed = schema.safeParse(body, {
    reportInput: true,
    error: houseIssueMessage,
  });
  return parsed.success ? parsed.data : invalidBodyResponse(c, parsed.error);
}

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
      (issue.message === NOT_JSON_MESSAGE ||
        issue.message.endsWith('received symbol')),
  );
  const issues = notJson
    ? [
        c.get('bodyIssue') ?? {
          path: '',
          message: NOT_JSON_MESSAGE,
        },
      ]
    : schemaIssues(error, 'is not a field this body takes');
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

/** The 400 a blank `?cursor=` or `?limit=` answers — the same envelope a
 * blank named filter gets from `readQuery`, for a route that reads the
 * parameter without declaring it through `PAGE_QUERY`. */
function blankParameterResponse(c: Context<RestEnv>, name: string): Response {
  return invalidQueryResponse(
    c,
    'INVALID_QUERY',
    `invalid query: "${name}" must not be blank`,
    [{ path: name, message: 'must not be blank' }],
  );
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
  const issues = schemaIssues(error, 'is not a parameter this route takes');
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

/**
 * A text field or parameter that must carry something once trimmed — the
 * one schema behind every "present with a value, or absent" rule on this
 * door, so a whitespace-only value is refused with the house sentence
 * ("must not be blank") rather than zod's "Too small: expected string to
 * have >=1 characters", which reports the length AFTER the trim as if it
 * were what the caller sent. The value the route reads is the trimmed one.
 */
export function nonBlank(max = 256) {
  return z.string().trim().min(1, 'must not be blank').max(max);
}

/** The `{cursor, limit}` pair every paginated list takes, for `readQuery`:
 * present with a value or absent, like every other parameter — a blank
 * `?cursor=` used to read as the first page, which is exactly the value
 * the last page's empty `continueCursor` hands a naive pager, so a loop
 * that sent it back walked the list from the start forever. The readers
 * (`readPageLimit`, `readKeysetCursor`, `readIntegerCursor`) refuse a blank
 * value too, for a route that declares its own shape. */
export const PAGE_QUERY = {
  cursor: nonBlank(2048).optional(),
  limit: nonBlank(32).optional(),
};

/** A named filter of a list (`?status=`, `?folderId=`): present with a
 * value, or absent. A blank value is refused rather than read as "match
 * nothing" on one route and "match everything" on the next. */
export function queryFilter(max = 256) {
  return nonBlank(max);
}

/**
 * The query string as ONE strict object: every parameter a route reads is
 * declared in `shape`, and any other name answers 400 `INVALID_QUERY`
 * naming it — the query-side twin of the `.strict()` bodies. An unknown
 * parameter used to be ignored, so a mistyped filter (`?statuss=active`)
 * silently answered the whole unfiltered list; a parameter given twice
 * (`?limit=1&limit=100`) took whichever value the framework read first.
 * Both are refused here, and the parsed object is what the route reads.
 */
export function readQuery<Shape extends z.ZodRawShape>(
  c: Context<RestEnv>,
  shape: Shape,
): z.infer<z.ZodObject<Shape>> | Response {
  const queries = c.req.queries();
  const repeated = Object.entries(queries)
    .filter(([, values]) => values.length > 1)
    .map(([name]) => name);
  const [first] = repeated;
  if (first !== undefined) {
    return invalidQueryResponse(
      c,
      'INVALID_QUERY',
      `invalid query: "${first}" is given more than once`,
      repeated.map((path) => ({ path, message: 'is given more than once' })),
    );
  }
  const single = Object.fromEntries(
    Object.entries(queries).map(([name, values]) => [name, values[0] ?? '']),
  );
  const parsed = z.object(shape).strict().safeParse(single, {
    reportInput: true,
    error: houseIssueMessage,
  });
  if (!parsed.success) return invalidQueryFromSchema(c, parsed.error);
  return parsed.data;
}

/** Route middleware for a GET that takes no query parameter at all — the
 * `readQuery` of an empty shape, so `?foo=1` on a lookup is the same
 * 400 a mistyped filter answers on a list. */
export const noQuery: MiddlewareHandler<RestEnv> = (c, next) => {
  const query = readQuery(c, {});
  return query instanceof Response ? Promise.resolve(query) : next();
};

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
  if (raw === undefined) return null;
  if (raw.trim() === '') return blankParameterResponse(c, 'cursor');
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
  if (raw === undefined) return null;
  if (raw.trim() === '') return blankParameterResponse(c, 'cursor');
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
 * The `limit` query of a list route: `pageLimit`'s clamping for a whole
 * number (the documented "out-of-range values are clamped"), the 400 for
 * anything else — `limit=abc` used to read as the default page size and
 * `limit=1.5` as one row, with nothing telling the caller, while the
 * message itself promised a whole number. (`INVALID_LIMIT`)
 */
export function readPageLimit(
  c: Context<RestEnv>,
  defaults: { fallback: number; max: number },
): number | Response {
  const raw = c.req.query('limit');
  if (raw !== undefined && raw.trim() === '') {
    return blankParameterResponse(c, 'limit');
  }
  if (raw !== undefined && !/^-?\d+$/.test(raw.trim())) {
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

/** The document fields the bytes lane reads: the blob it serves, the name
 * the download carries, and — for a content-only document — the type and
 * freshness of its inline text. */
export type ServableDocument = Pick<
  DocumentRow,
  'fileRef' | 'title' | 'mimeType' | 'updatedAt'
>;

/** What a 503 from the object store asks a consumer to wait — advisory,
 * in whole seconds, the way the rate-limits page's own 429 speaks. */
const OBJECT_STORE_RETRY_AFTER_SECONDS = '5';

/**
 * The bytes lane both document families share — a project file's
 * `GET …/files/{documentId}/content` and a Hub document's
 * `GET /api/v1/documents/{id}/content`: the blob streamed from the object
 * store in the response itself (no redirect a client would re-send its
 * bearer across), the document's title as the RFC 6266 download name,
 * `Range` honoured (206, or a bodiless 416 naming the size for a range
 * the file cannot satisfy — judged in `openFileContent` before any byte
 * is fetched), the validators the store issued compared by the store
 * (`If-None-Match` / `If-Modified-Since` answer 304 with no bytes;
 * `If-Range` guards a resumed download), HEAD answering the headers alone
 * (`Range` ignored), and a store that does not answer as the documented
 * 503 with `Retry-After`. The bytes are user-uploaded, so they never render as a
 * document on this origin: attachment + nosniff, as every blob lane; the
 * client's own cache may keep what the tag lets it revalidate
 * (`private, no-cache`), no shared cache may.
 *
 * `absent` is the family's own opaque 404 (a project file is
 * `FILE_NOT_FOUND`, a Hub document `DOCUMENT_NOT_FOUND`) — for a blob the
 * store no longer holds, and for a content-only document unless the family
 * hands over `inline`: the Hub lane serves such a document's text itself,
 * typed as its stored MIME type (`text/plain` when it has none), so what
 * `POST /api/v1/documents` accepted inline reads back from the same URL
 * every file-backed document answers.
 */
export async function serveDocumentBytes(
  c: Context<RestEnv>,
  sql: Sql,
  doc: ServableDocument,
  options: {
    absent: { message: string; code: string };
    inline?: () => Promise<string | null>;
  },
): Promise<Response> {
  const head = c.req.method === 'HEAD';
  if (doc.fileRef === null) {
    if (options.inline === undefined) {
      return notFound(c, options.absent.message, options.absent.code);
    }
    const text = (await options.inline()) ?? '';
    const bytes = new TextEncoder().encode(text);
    const mime = doc.mimeType ?? 'text/plain';
    // The text is the representation, so its tag is computed here — the
    // same validator a JSON read carries — and compared here.
    const etag = entityTagOf(bytes);
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch !== undefined && ifNoneMatchMatches(ifNoneMatch, etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          'last-modified': new Date(doc.updatedAt).toUTCString(),
          'accept-ranges': 'none',
          'cache-control': 'private, no-cache',
        },
      });
    }
    const headers = new Headers({
      'content-type': /;\s*charset=/i.test(mime)
        ? mime
        : `${mime}; charset=utf-8`,
      'content-length': String(bytes.byteLength),
      etag,
      'last-modified': new Date(doc.updatedAt).toUTCString(),
      // Inline text is not sliceable: a `Range` is ignored and the whole
      // text answers 200, which is what `none` tells a resuming client.
      'accept-ranges': 'none',
    });
    stampDownloadHeaders(headers, doc.title);
    return new Response(head ? null : bytes, { status: 200, headers });
  }
  const range = c.req.header('range');
  const ifNoneMatch = c.req.header('if-none-match');
  const ifModifiedSince = c.req.header('if-modified-since');
  const ifRange = c.req.header('if-range');
  let served: FileContent | null;
  try {
    served = await openFileContent(
      sql,
      { organizationId: c.get('organizationId') },
      doc.fileRef,
      {
        head,
        ...(range === undefined ? {} : { range }),
        // The validators this lane ships are the store's, so the store
        // compares them: a match answers 304 and no bytes move.
        conditions: {
          ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
          ...(ifModifiedSince === undefined ? {} : { ifModifiedSince }),
          ...(ifRange === undefined ? {} : { ifRange }),
        },
        signal: c.req.raw.signal,
      },
    );
  } catch (error) {
    if (!(error instanceof FileError)) throw error;
    console.warn(
      '[rest] content serve failed:',
      error instanceof Error ? error.message : String(error),
    );
    if (error.status === 503) {
      return c.json(
        {
          error: 'The object store did not serve the file; retry shortly.',
          code: 'OBJECT_STORE_UNAVAILABLE',
        },
        503,
        { 'retry-after': OBJECT_STORE_RETRY_AFTER_SECONDS },
      );
    }
    return notFound(c, options.absent.message, options.absent.code);
  }
  if (served === null) {
    return notFound(c, options.absent.message, options.absent.code);
  }
  const headers = new Headers();
  // A 304 carries the validators and nothing about a body it does not
  // have (RFC 9110 §15.4.5); a 416 carries `Content-Range` naming the size
  // and an explicitly empty body — never the type or length of anything
  // (the store's own 416 describes an XML error document, and copying
  // that length onto a bodiless answer made the edge abort the stream);
  // everything else describes the bytes.
  const notModified = served.status === 304;
  const unsatisfiable = served.status === 416;
  const copied = notModified
    ? ['etag', 'last-modified', 'accept-ranges']
    : unsatisfiable
      ? ['content-range', 'etag', 'last-modified', 'accept-ranges']
      : [
          'content-type',
          'content-length',
          'content-range',
          'etag',
          'last-modified',
          'accept-ranges',
        ];
  for (const name of copied) {
    const value = served.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!notModified && !unsatisfiable && !headers.has('content-type')) {
    headers.set('content-type', 'application/octet-stream');
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  if (unsatisfiable) headers.set('content-length', '0');
  if (notModified) {
    headers.set('cache-control', 'private, no-cache');
  } else if (!unsatisfiable) {
    stampDownloadHeaders(headers, doc.title);
  }
  return new Response(unsatisfiable ? null : served.body, {
    status: served.status,
    headers,
  });
}

/** Object keys are nameless (`<org>/<uuid>`); the document's title is the
 * filename the documented Content-Disposition carries. */
function stampDownloadHeaders(headers: Headers, title: string | null): void {
  headers.set(
    'content-disposition',
    attachmentDisposition(title ?? 'download'),
  );
  headers.set('x-content-type-options', 'nosniff');
  // The client's own cache may keep the bytes it must revalidate — that is
  // what the ETag is for; no shared cache may (`private`). `no-store` used
  // to tell a mirror to discard the very body the tag would let it keep.
  headers.set('cache-control', 'private, no-cache');
}
