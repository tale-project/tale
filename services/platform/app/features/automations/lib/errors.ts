/**
 * Author-facing message for a refused automation write.
 *
 * The store throws structured `ConvexError`s whose `data.message` already names
 * the problem AND the fix — the deploy gate's "was saved with failing tests —
 * fix them and save a new version", the naming rule a slug broke, the automation
 * that has no version to run. Those sentences are the whole value of the
 * refusal, so they are surfaced verbatim rather than flattened into a generic
 * per-code line.
 *
 * Duck-types `ConvexError.data` rather than using `instanceof`: Vite chunk
 * splitting can produce more than one copy of the class, which breaks the
 * prototype check even though the value IS a ConvexError.
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
