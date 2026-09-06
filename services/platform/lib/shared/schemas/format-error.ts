/**
 * Shared ZodError → human-readable-string formatters. Every parse site that
 * surfaces a schema failure to a log line, a thrown `Error`/`AppError`, or
 * an admin-facing message should go through one of these instead of
 * hand-rolling a summary or (worse) interpolating `error.message`, which is
 * the raw `[{"expected":...,"path":[...]}]` JSON dump zod/v4 produces — an
 * actionable message names the field path and the human phrase, never that
 * dump.
 *
 * Layer A: imports ONLY `zod/v4` — no `node:*`, no `convex/_generated` — so
 * this is safe to import from V8 Convex code, `'use node'` actions, plain Bun
 * scripts, and vitest alike.
 */

import { z } from 'zod/v4';

interface FormatZodErrorOptions {
  /** How many issues to spell out before truncating with a "(+N more)" tail. */
  maxIssues?: number;
}

const DEFAULT_MAX_ISSUES = 3;

/**
 * One-line summary: `path: message; path: message (+N more)`. Issues with an
 * empty path (a root-level refinement) render as just the message. Truncates
 * at `maxIssues` (default 3) so a schema with dozens of violations still
 * yields a readable, boundedly long line.
 */
export function formatZodError(
  error: z.ZodError,
  opts: FormatZodErrorOptions = {},
): string {
  const maxIssues = opts.maxIssues ?? DEFAULT_MAX_ISSUES;
  const issues = error.issues;
  const summary = issues
    .slice(0, maxIssues)
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
  const more =
    issues.length > maxIssues ? ` (+${issues.length - maxIssues} more)` : '';
  return `${summary}${more}`;
}

/**
 * `formatZodError` prefixed with a caller-supplied label — the common shape
 * for a thrown `Error`/`AppError` message: `${label}: ${formatZodError()}`.
 */
export function zodErrorMessage(
  label: string,
  error: z.ZodError,
  opts?: FormatZodErrorOptions,
): string {
  return `${label}: ${formatZodError(error, opts)}`;
}
