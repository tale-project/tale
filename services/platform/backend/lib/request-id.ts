import type { Context } from 'hono';

/**
 * The request id the app-level `requestId` middleware stamped, when any —
 * the one handle a caller can quote back from an error response.
 *
 * A module of its own, with nothing of the backend behind it: the hygiene
 * rules that read it (`http-hygiene.ts`) are shared with the web tier, and
 * importing it from `error-reporting.ts` made that tier load the metrics
 * collectors, the job registry and two database clients to answer a HEAD
 * with a length (tale-project/tale#4942, finding 2).
 */
export function requestIdOf(c: Context): string | undefined {
  const value: unknown = c.get('requestId');
  return typeof value === 'string' && value !== '' ? value : undefined;
}
