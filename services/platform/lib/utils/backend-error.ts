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
