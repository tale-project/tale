/**
 * Readers for a STRUCTURED error's `{ code, message, userMessage }` payload —
 * the shape both the app's `BackendError` and the 0.4 `AppError` carry.
 *
 * Duck-typed on `data` rather than `instanceof`: Vite's chunk splitting can
 * emit more than one copy of a class, and a prototype check then fails on an
 * error that IS one. The payload is what every call site actually consumes,
 * so checking it directly is both more robust and more honest.
 */

/** One string field of a structured error's payload, or undefined. */
function stringField(err: unknown, field: string): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const { data } = err;
  if (data === null || typeof data !== 'object' || !(field in data)) {
    return undefined;
  }
  const value: unknown = Reflect.get(data, field);
  return typeof value === 'string' ? value : undefined;
}

/** The machine `code` a surface branches on (e.g. a connector that isn't
 *  connected), or undefined when the error carries none. */
export function backendErrorCode(err: unknown): string | undefined {
  return stringField(err, 'code');
}

/** The structured `message`, falling back for an unstructured throw. */
export function backendErrorMessage(err: unknown, fallback: string): string {
  return stringField(err, 'message') ?? fallback;
}

/**
 * The `userMessage` a handler explicitly marked safe to display verbatim.
 * Unlike `message` (which may carry codes or developer-facing text), this is
 * a contract; absent ⇒ the caller's generic copy.
 */
export function backendUserMessage(err: unknown, fallback: string): string {
  return stringField(err, 'userMessage') ?? fallback;
}

/**
 * The sentence a handler wrote beside its code — a refusal explaining
 * itself ("price: Number must be less than or equal to …") — or undefined
 * when the payload carries only the code (the app's fetch boundary repeats
 * a bare code as the message) or nothing structured at all. A toast puts
 * it under its localized title; it never replaces one.
 *
 * A lapsed session (the session door's 401 `UNAUTHORIZED`) reads as the
 * app's localized "session ended" sentence: the app's error normalization
 * (`toBackendError` in `app/lib/backend/adapters.ts`) puts it in place of
 * the door's guidance for API clients, so this reader, like every other,
 * needs no case of its own.
 */
export function backendRefusalReason(err: unknown): string | undefined {
  const message = stringField(err, 'message');
  if (message === undefined || message.length === 0) return undefined;
  const code = stringField(err, 'code');
  return message === code ? undefined : message;
}

/** The code every app door answers a body its schema refused with
 * (`backend/lib/invalid-body-response.ts`). */
const INVALID_BODY_CODE = 'invalid body';

/**
 * The field-naming sentence of a refused body ("email: Invalid email
 * address") — every app door's `invalid body` answer carries one, so a
 * generic failure toast can say which field instead of "Try again", which
 * would only send the same body again. Undefined for any other error: a
 * different code's `message` is not a display contract.
 */
export function invalidBodyReason(err: unknown): string | undefined {
  if (backendErrorCode(err) !== INVALID_BODY_CODE) return undefined;
  return backendRefusalReason(err);
}
