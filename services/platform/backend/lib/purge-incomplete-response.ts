import type { Context, Env } from 'hono';

import type { PurgeIncompleteError } from '../domains/retention/service.ts';

/**
 * The answer an app route gives when a hard delete could not remove every
 * dead surface (a corpus row, the bytes): the document row was KEPT by
 * contract so the caller can retry, and nothing was written that says
 * otherwise. Not a 4xx — the request was valid; the infrastructure failed —
 * and not the bare text 500 an unmapped error becomes, which reads as a
 * crash and reports to error tracking on every retry. One shape for the
 * document and folder doors, so the two never drift.
 */
export function purgeIncompleteResponse<E extends Env>(
  c: Context<E>,
  error: PurgeIncompleteError,
): Response {
  return c.json({ error: error.code, message: error.message }, 503);
}
