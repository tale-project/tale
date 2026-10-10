/**
 * A refusal as a coding agent reads it, and how one is read from what a
 * surface threw: every MCP surface that runs a domain writer — the tool
 * call itself (`tools.ts`), the settings tools — turns a thrown refusal
 * into the same `{error, code, hint?, data?}` the agent branches on, and
 * leaves anything else to be answered as a fault.
 */

import { isCodedRefusal } from '../../../lib/engine/api/refusal';
import { isRecord } from '../../../lib/utils/type-utils';
import { codedAppError } from '../../lib/app-error-response';
import { rateLimitExceededCause } from '../../lib/rate-limit-response';

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
