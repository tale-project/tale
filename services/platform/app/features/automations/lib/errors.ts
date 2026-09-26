/**
 * Author-facing message for a refused automation write.
 *
 * The store throws structured `AppError`s whose `data.message` already names
 * the problem AND the fix — the deploy gate's "was saved with failing tests —
 * fix them and save a new version", the naming rule a slug broke, the automation
 * that has no version to run. Those sentences are the whole value of the
 * refusal, so they are surfaced verbatim rather than flattened into a generic
 * per-code line.
 *
 * Duck-types `AppError.data` rather than using `instanceof`: Vite chunk
 * splitting can produce more than one copy of the class, which breaks the
 * prototype check even though the value IS a AppError.
 */

function errorData(error: unknown): Record<string, unknown> | undefined {
  if (error === null || typeof error !== 'object' || !('data' in error)) {
    return undefined;
  }
  const { data } = error;
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
      (data as Record<string, unknown>)
    : undefined;
}

/** The server's own sentence, or the error's message when it carries none. */
export function automationErrorMessage(error: unknown): string {
  const message = errorData(error)?.message;
  if (typeof message === 'string' && message.length > 0) return message;
  return error instanceof Error ? error.message : String(error);
}

/** The machine code the store attached, for branching on a refusal kind. */
export function automationErrorCode(error: unknown): string | undefined {
  const code = errorData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The version that landed while a draft was open — the detail a stale save
 * (`AUTOMATION_VERSION_STALE`) carries so the editor can save on top of it.
 * `null` when the automation has no version any more; `undefined` when the
 * error carries no such detail.
 */
export function automationErrorLatestVersion(
  error: unknown,
): number | null | undefined {
  const latest = errorData(error)?.latestVersion;
  return typeof latest === 'number' || latest === null ? latest : undefined;
}

/**
 * A read that answered "no such thing". The store answers `null` for a row it
 * cannot see; the backend's route answers 404, which the fetch layer surfaces
 * as a structured refusal (the route's `error` string as the code) rather
 * than as `null` data — and a foreign or mistyped id reads exactly the same,
 * never a leak. A transport or server failure carries no structured code and
 * is NOT missing: it keeps its own error state.
 */
export function isMissingAutomationRead(query: {
  data: unknown;
  isError: boolean;
  error: unknown;
}): boolean {
  if (query.data === null) return true;
  return query.isError && automationErrorCode(query.error) !== undefined;
}
