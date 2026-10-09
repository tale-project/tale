/**
 * Whether something a host threw is a REFUSAL — an answer the caller can act
 * on, with a stable code and its own sentence — or a FAULT, whose text may
 * name internals (a database's address, a SQL state, a user name) and never
 * reaches a caller.
 *
 * One rule for every door that turns a thrown value into an answer: the
 * engine's dispatch (`dispatch.ts`, which answers a refusal as data and
 * rethrows a fault to its host) and the MCP endpoint's tool call
 * (`backend/domains/mcp/tools.ts`, which answers a fault as
 * `INTERNAL_ERROR` with the request id). A refusal is:
 *
 * - a structured refusal (the platform's `AppError`): its `data` carries a
 *   stable `code` and the sentence — never its `message`, which serializes
 *   the whole payload;
 * - a domain error (`AutomationError`, `ProjectError`, `ConfigurationError`,
 *   …) whose own `code` has the shape of a stable code and whose `status`
 *   is a 4xx;
 * - one of the classes that refuse without a status of their own
 *   (`ActorAuthError`, `CapabilityAuthError`), with such a code.
 *
 * Anything else is a fault — a socket's `ECONNREFUSED` has the code's shape
 * but no 4xx status, a database's SQLSTATE (`23505`) never has the shape.
 */

/** The shape of a stable refusal code. */
const REFUSAL_CODE = /^[A-Z][A-Z0-9_]*$/;

/** Error classes that refuse without an HTTP status of their own. */
const STATUSLESS_REFUSALS: ReadonlySet<string> = new Set([
  'ActorAuthError',
  'CapabilityAuthError',
]);

/** Whether `value` has the shape of a stable refusal code. */
function isRefusalCode(value: unknown): value is string {
  return typeof value === 'string' && REFUSAL_CODE.test(value);
}

/**
 * A structured refusal's payload — the `data` of the platform's `AppError`
 * when it carries a stable `code` — or null. The error's own `message` is
 * never read: it serializes the whole payload.
 */
export function structuredRefusal(error: unknown): {
  code: string;
  message: string;
  data?: Record<string, unknown>;
} | null {
  if (error === null || typeof error !== 'object') return null;
  if (typeof Reflect.get(error, 'code') === 'string') return null;
  const payload: unknown = Reflect.get(error, 'data');
  if (payload === null || typeof payload !== 'object') return null;
  const code: unknown = Reflect.get(payload, 'code');
  if (!isRefusalCode(code)) return null;
  const sentence: unknown = Reflect.get(payload, 'message');
  const detail: unknown = Reflect.get(payload, 'data');
  return {
    code,
    message: typeof sentence === 'string' ? sentence : code,
    ...(detail !== null &&
      typeof detail === 'object' &&
      !Array.isArray(detail) && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        data: detail as Record<string, unknown>,
      }),
  };
}

/**
 * Whether `error` is a domain error that refuses: its own `code` has the
 * shape of a stable code, and it carries a 4xx `status` — or, without a
 * status, is one of the classes that refuse without one.
 */
export function isCodedRefusal(error: unknown): error is Error & {
  code: string;
} {
  if (!(error instanceof Error)) return false;
  if (!isRefusalCode(Reflect.get(error, 'code'))) return false;
  const status: unknown = Reflect.get(error, 'status');
  return typeof status === 'number'
    ? status >= 400 && status < 500
    : STATUSLESS_REFUSALS.has(error.name);
}
