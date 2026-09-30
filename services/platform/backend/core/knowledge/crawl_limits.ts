/**
 * The website crawler's operator-tunable budgets, read from the environment
 * once at boot the way the knowledge index repair reads its own.
 */

/** The default cap on a document the crawler downloads and extracts — the
 * platform's document-upload allowance, so a brochure PDF that a member could
 * upload can also be crawled. It was a fixed 25 MiB, and a 26 MiB brochure
 * read "too large to fetch" with no way to change that (2026-09-30). */
export const DEFAULT_CRAWL_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;

/** Below this a cap serves nobody: every real document would be refused. */
export const MIN_CRAWL_DOCUMENT_MAX_BYTES = 1024 * 1024;

/** `KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES` — the largest document (in bytes) the
 * crawler fetches and extracts; a larger one is recorded on its page as
 * `response_too_large`. Unset or empty reads the default; a value that is
 * not a whole number of at least 1 MiB is refused with a warning and reads
 * the default too, never a silently tiny or infinite cap. */
export function crawlDocumentMaxBytes(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (message) => console.warn(message),
): number {
  const raw = env.KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_CRAWL_DOCUMENT_MAX_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_CRAWL_DOCUMENT_MAX_BYTES) {
    warn(
      `[crawl] KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES=${raw} is not a whole number of at least ${MIN_CRAWL_DOCUMENT_MAX_BYTES} bytes — using the default (${DEFAULT_CRAWL_DOCUMENT_MAX_BYTES})`,
    );
    return DEFAULT_CRAWL_DOCUMENT_MAX_BYTES;
  }
  return parsed;
}
