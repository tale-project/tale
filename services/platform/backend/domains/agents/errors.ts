import type { Context, Env } from 'hono';

import {
  appErrorResponse,
  type CodedRefusalStatus,
} from '../../lib/app-error-response.ts';

/**
 * HTTP status for every coded refusal the agent file layer can throw — ONE
 * map for the app routes and the REST family, so a permission or validation
 * failure reads as the 403/400 it is on both doors instead of a 500 on one
 * of them.
 */
export const AGENT_ERROR_STATUS: Readonly<Record<string, CodedRefusalStatus>> =
  {
    INVALID_AGENT_SLUG: 400,
    INVALID_AGENT: 400,
    AGENT_FORBIDDEN: 403,
    AGENT_HISTORY_ENTRY_NOT_FOUND: 404,
    AGENT_MALFORMED: 422,
  };

/** `{ error, message }` with the mapped status; rethrows an unmapped error. */
export function agentErrorResponse<E extends Env>(
  c: Context<E>,
  error: unknown,
): Response {
  return appErrorResponse(c, error, AGENT_ERROR_STATUS);
}
