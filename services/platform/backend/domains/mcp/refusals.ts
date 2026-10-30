/**
 * A refusal as a coding agent reads it, and how one is read from what a
 * surface threw: every MCP surface that runs a domain writer — the tool
 * call itself (`tools.ts`), the settings tools — turns a thrown refusal
 * into the same `{error, code, hint?, data?}` the agent branches on, a
 * database that is not answering into the wait it asks for, and leaves
 * anything else to be answered as a fault.
 */

import { isCodedRefusal } from '../../../lib/engine/api/refusal';
import { isRecord } from '../../../lib/utils/type-utils';
import {
  databaseUnavailableCause,
  describeDatabaseError,
  knowledgeDatabaseUnavailable,
} from '../../db/unavailable';
import { DATABASE_RETRY_AFTER_SECONDS } from '../../error-reporting';
import { codedAppError } from '../../lib/app-error-response';
import { rateLimitExceededCause } from '../../lib/rate-limit-response';

/** How many issues one refusal lists — enough to fix any real call in one
 * round trip, never a hostile call echoed back at length. */
export const MAX_ARGUMENT_ISSUES = 50;

/** A refusal as the agent reads it. */
export interface McpRefusal {
  error: string;
  code: string;
  hint?: string;
  data?: Record<string, unknown>;
}

function plainData(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * A thrown refusal as data, or null when what was thrown is a fault. A
 * refusal keeps its code and its own sentence: a spent budget is
 * `RATE_LIMITED` with the wait; a coded `AppError` gives its `data.message`
 * (its `message` serializes the whole payload, which never reaches an
 * agent); a domain error (`AutomationError`, `ConfigurationError`,
 * `ActorAuthError`, …) gives its code, sentence, hint and data.
 */
export function refusalFromThrown(error: unknown): McpRefusal | null {
  const limited = rateLimitExceededCause(error);
  if (limited !== null) {
    return {
      error: `this key holder's budget for the call is spent; retry in ${Math.max(1, Math.ceil(limited.retryAfter / 1000))} s`,
      code: 'RATE_LIMITED',
      hint: 'wait data.retryAfterMs, then call again',
      data: { retryAfterMs: limited.retryAfter },
    };
  }
  const coded = codedAppError(error);
  if (coded !== null) {
    return {
      error: coded.message,
      code: coded.code,
      ...(coded.data === undefined ? {} : { data: coded.data }),
    };
  }
  // One rule with the engine's dispatch (`lib/engine/api/refusal.ts`): a
  // stable code and a 4xx status, or a class that refuses without one.
  if (!isCodedRefusal(error)) return null;
  const { code } = error;
  const hint: unknown = Reflect.get(error, 'hint');
  const data = plainData(Reflect.get(error, 'data'));
  return {
    error: error.message,
    code,
    ...(typeof hint === 'string' && hint !== '' ? { hint } : {}),
    ...(data === undefined ? {} : { data }),
  };
}

/**
 * What a call answers when the database could not serve it — restarting,
 * failing over, a host that is down (`db/unavailable.ts`) — or null when the
 * database is not why it failed. A restart is routine, not a defect: like the
 * REST door's 503 (`databaseUnavailableResponse`), this writes one warning
 * line, reports nothing, and asks the agent to wait as long as that door's
 * `Retry-After`. `failed` names what could not finish, `retry` what the agent
 * does once it has waited.
 *
 * A bare socket error counts only on a database client's query (postgres.js
 * stamps its own): the same `ECONNREFUSED` from a model provider or the
 * sandbox stays a fault.
 *
 * A knowledge database that is unavailable — the deployment's default corpus
 * database or an organization's own — answers `KNOWLEDGE_DATABASE_UNAVAILABLE`
 * with the same wait, as the REST door does: it is not the platform's
 * database restarting. Its pool reports an outage that outlasts a routine
 * restart, once (`core/knowledge/pool.ts`); a call reports nothing.
 */
export function databaseUnavailableRefusal(
  error: unknown,
  failed: string,
  retry: string,
  requestId: string | null,
): McpRefusal | null {
  const knowledge = knowledgeDatabaseUnavailable(error);
  if (knowledge !== null) {
    console.warn(
      `[mcp] knowledge database unavailable (${knowledge}) — ${failed}${requestId === null ? '' : ` (request ${requestId})`}: ${describeDatabaseError(error)}`,
    );
    return {
      error: `${failed} could not reach the knowledge database, which is not answering right now; retry in ${DATABASE_RETRY_AFTER_SECONDS} s`,
      code: 'KNOWLEDGE_DATABASE_UNAVAILABLE',
      hint: `wait data.retryAfterMs, then ${retry}`,
      data: {
        retryAfterMs: DATABASE_RETRY_AFTER_SECONDS * 1000,
        ...(requestId === null ? {} : { requestId }),
      },
    };
  }
  const cause = databaseUnavailableCause(error);
  if (cause === undefined) return null;
  console.warn(
    `[mcp] database unavailable — ${failed}${requestId === null ? '' : ` (request ${requestId})`}: ${describeDatabaseError(cause)}`,
  );
  return {
    error: `${failed} could not reach the platform’s database, which is not answering right now — it may be restarting; retry in ${DATABASE_RETRY_AFTER_SECONDS} s`,
    code: 'DATABASE_UNAVAILABLE',
    hint: `wait data.retryAfterMs, then ${retry}`,
    data: {
      retryAfterMs: DATABASE_RETRY_AFTER_SECONDS * 1000,
      ...(requestId === null ? {} : { requestId }),
    },
  };
}
