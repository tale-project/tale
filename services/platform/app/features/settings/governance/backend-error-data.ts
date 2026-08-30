/**
 * Duck-typed reader for a thrown `BackendError`'s `data` payload. Vite chunk
 * splitting can produce multiple `BackendError` class copies, which breaks
 * `instanceof`, so we check shape instead. Shared by the governance error
 * mappers (legal-hold, data-subject-requests).
 */
export function readBackendErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = err.data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
  return data as Record<string, unknown>;
}

/** Read a string field from a parsed BackendError `data` record. */
export function pickString(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!data) return undefined;
  const v = data[key];
  return typeof v === 'string' ? v : undefined;
}
