/**
 * The sentence a file fails with when it needs more memory than this
 * deployment gives one file: the limit it went over, and the setting that
 * raises it.
 *
 * A deployment reads a file — a document's text, a recording — in a process
 * of its own under a memory cap (`backend/lib/heavy-slot`,
 * tale-project/tale#4942). A file that needs more is stopped, and its
 * failure is stored as this sentence wherever the lane that read it stores
 * its failures: a document's indexing error, a recording's transcription
 * error. So a surface that only has the stored text still recognises the
 * cause and can say it in the reader's language, with the same number
 * ({@link memoryLimitOf}), as it does for a usage limit
 * (`usage-limit.ts`).
 *
 * Free of imports: the backend writes the sentence and the app reads it.
 */

/** The setting that raises the limit, in MiB. */
export const MEMORY_LIMIT_SETTING = 'HEAVY_SLOT_MEMORY_MB';

/** The sentence, for a limit of `limitMb` MiB. */
export function memoryLimitSentence(limitMb: number): string {
  return `This file needs more memory than the ${limitMb} MiB this server gives one file. An administrator can raise the limit with ${MEMORY_LIMIT_SETTING}.`;
}

const SENTENCE =
  /^This file needs more memory than the (\d+) MiB this server gives one file\./;

/**
 * The limit a stored failure sentence names, in MiB; `undefined` for a
 * sentence that is not this one.
 */
export function memoryLimitOf(
  text: string | null | undefined,
): number | undefined {
  const named = typeof text === 'string' ? SENTENCE.exec(text) : null;
  return named === null ? undefined : Number(named[1]);
}
