/**
 * The structured refusal every layer speaks: a machine `code` plus whatever
 * data the surface needs to explain itself.
 *
 * Handlers throw it, the HTTP boundary maps it to a status, and the browser's
 * own copy (`app/lib/backend/backend-error.ts`) carries the same `{ data }`
 * shape back to the surfaces. Named `data` — not a flat set of fields —
 * because that is the shape the 0.4 contract established and every reader, on
 * both sides of the wire, already consumes.
 *
 * `AppError` replaces `ConvexError`: same constructor, same `.data`, no
 * dependency on a retired runtime.
 */
export class AppError<Data = unknown> extends Error {
  readonly data: Data;

  constructor(data: Data) {
    // `message` SERIALIZES the payload rather than picking one field out of
    // it. A structured refusal's identity is its `code`, and `message` is what
    // lands in logs, stack traces and `toThrow(/CODE/)` assertions — surfacing
    // only the human sentence would hide the code exactly where an operator
    // needs it. Surfaces render `data.message` / `data.userMessage` instead
    // (see `lib/utils/backend-error.ts`).
    super(typeof data === 'string' ? data : safeStringify(data));
    this.name = 'AppError';
    this.data = data;
  }
}

/** JSON, or a best-effort description when the payload cannot be serialized
 *  (a cycle, a BigInt) — building an error must never itself throw. */
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return String(data);
  }
}
