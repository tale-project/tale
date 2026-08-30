/**
 * The app's structured error: a deterministic refusal from the backend,
 * carrying the machine `code` and human `message` the surfaces branch on.
 *
 * Every one of these is CONSTRUCTED here in the browser — `toConvexError`
 * normalizes a 4xx into it — so the class is the app's own, not the retired
 * Convex runtime's. Same `{ data }` shape the 0.4 contract used, so the
 * consumers that read `error.data.code` are unchanged.
 *
 * Read it with the duck-typed helpers in `lib/utils/convex-error.ts` rather
 * than `instanceof` wherever you can: Vite's chunk splitting can emit more
 * than one copy of a class, and a prototype check then fails on an error that
 * IS one of these.
 */
export class BackendError<Data = unknown> extends Error {
  readonly data: Data;

  constructor(data: Data) {
    super(
      data !== null &&
        typeof data === 'object' &&
        'message' in data &&
        typeof data.message === 'string'
        ? data.message
        : 'Backend error',
    );
    this.name = 'BackendError';
    this.data = data;
  }
}

/** True when `error` carries a structured `data` payload — the shape every
 *  refusal-aware surface actually consumes. Prefer this to `instanceof`. */
export function isBackendError(
  error: unknown,
): error is { data: Record<string, unknown> } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'data' in error &&
    error.data !== null &&
    typeof error.data === 'object'
  );
}
