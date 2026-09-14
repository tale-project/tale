/**
 * A refusal the extractors raise for bytes that CANNOT be indexed however
 * often they are retried — so the indexer lands the file on the terminal
 * `unsupported` status with a stable code, instead of storing a parser's raw
 * sentence as the public `indexing.error` and burning the job's retries on
 * the same bytes (2026-09-14 evaluation, g3-1 / g3-2).
 *
 * `not_text`: binary data behind a text extension (a `.txt` that is a PE
 * image, a PDF renamed `.txt`); the caller re-exports as UTF-8 text.
 * `malformed`: the bytes do not parse as the format the extension claims — a
 * corrupt or encrypted PDF, a broken Office archive.
 */
export class ExtractionError extends Error {
  readonly code: 'not_text' | 'malformed';

  constructor(code: 'not_text' | 'malformed', message: string) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}
