import {
  CHAT_ERROR_CODES,
  classifyChatErrorCode,
  type ChatErrorCode,
} from '../../../lib/shared/chat-errors.ts';
import type { WorkflowAgentFailureCode } from './agent_retry.ts';

/**
 * The stable cause of a FAILED run — `Run.failureCode` on the wire — so an
 * integrator branches on the code ("retry", "alert a person", "drop") instead
 * of on `detail`'s sentence, which is not contractual (2026-09-14 evaluation,
 * g5-3). Only causes the engine can actually tell apart are named; the
 * catch-all is `node_error`, the author's own problem.
 *
 * Three families:
 * - the engine's own: `node_error` (a node's code, template, forEach or
 *   `output` expression failed, an authoring refusal), `connector_error`
 *   (a connector action refused or failed), `llm_output_invalid` (the
 *   model's reply did not satisfy the node's `outputSchema`),
 *   `approval_rejected`, `execution_limit` (the execution guard),
 *   `automation_deleted` (the automation vanished mid-flight),
 *   `engine_incompatible` (the run's saved progress could not be read by
 *   this version of Tale, so it was stopped instead of starting over),
 *   `effect_in_doubt` (a person failed the run at a write that may already
 *   have reached its service when the run was interrupted);
 * - an `llm` node's provider, reusing the chat surface's own vocabulary —
 *   `credit_exhausted`, `auth_error`, `rate_limited`, `provider_unreachable`,
 *   `provider_error`, …: the account or the provider, not the request;
 * - an `agent` node's turn, after the in-node retries — `harness_error`,
 *   `turn_crashed`, `session_gone`, `deadline`, `ask_expired`,
 *   `budget_exceeded`, ….
 */
const ENGINE_FAILURE_CODES = [
  'node_error',
  'connector_error',
  'llm_output_invalid',
  'approval_rejected',
  'execution_limit',
  'automation_deleted',
  'engine_incompatible',
  'effect_in_doubt',
] as const;

const AGENT_FAILURE_CODES = [
  'harness_error',
  'turn_crashed',
  'session_gone',
  'start_failed',
  'harvest_failed',
  'resume_failed',
  'deadline',
  'ask_expired',
  'budget_exceeded',
] as const satisfies readonly WorkflowAgentFailureCode[];

type AgentWireFailureCode = (typeof AGENT_FAILURE_CODES)[number];

/** The agent settle codes only the retry machinery tells apart, and the wire
 * code each reports as once the retries are spent: the code the same failure
 * carried before it was named, so `Run.failureCode` — an OpenAPI enum
 * integrators branch on — does not move under them. A start refused while
 * every broker account cooled down never launched (`start_failed`, as every
 * refused start was), nor did one that waited for sandbox room; a 401 on a
 * token the broker refreshed under the turn is the harness's own error, as
 * it was. Every agent code is either on the
 * wire or here — a new one that is neither fails to compile. */
const AGENT_RETRY_ONLY_CODES: Record<
  Exclude<WorkflowAgentFailureCode, AgentWireFailureCode>,
  AgentWireFailureCode
> = {
  credential_cooldown: 'start_failed',
  credential_rotated: 'harness_error',
  // The sandbox ended a hung harness: it reads as the crashed turn it was
  // before the hang had a name, the run's detail says it stalled.
  turn_stalled: 'turn_crashed',
  // Waited for sandbox room past the node's execution guard: it never
  // launched, as every refused start before it.
  sandbox_capacity: 'start_failed',
  // Refused while the run's workspace was being destroyed: a refused start,
  // as it read before the code was named.
  sandbox_destroying: 'start_failed',
};

const AGENT_RETRY_ONLY_CODE_MAP: ReadonlyMap<string, RunFailureCode> = new Map(
  Object.entries(AGENT_RETRY_ONLY_CODES),
);

/** The chat codes that describe a PROVIDER failure — the ones an `llm` node
 * can meaningfully surface. The pipeline's own buckets (`thread_busy`,
 * `tool_failure`, `generic`) are not provider facts and fold into
 * `node_error`. */
const PROVIDER_FAILURE_CODES = CHAT_ERROR_CODES.filter(
  (
    code,
  ): code is Exclude<
    ChatErrorCode,
    'thread_busy' | 'tool_failure' | 'generic'
  > => code !== 'thread_busy' && code !== 'tool_failure' && code !== 'generic',
);

/** Every failure code, in family order and WITH the overlaps — `budget_exceeded`
 * is both a chat/provider code and an agent code, so this list carries it
 * twice. The type below dedupes on its own (a union); the exported enum is
 * deduped explicitly so it never ships a repeated value. */
const FAILURE_CODES_WITH_OVERLAPS = [
  ...ENGINE_FAILURE_CODES,
  ...PROVIDER_FAILURE_CODES,
  ...AGENT_FAILURE_CODES,
] as const;

export type RunFailureCode = (typeof FAILURE_CODES_WITH_OVERLAPS)[number];

/** Every value `Run.failureCode` can carry — the OpenAPI enum, each value
 * once. `budget_exceeded` appeared twice (the chat and agent families both
 * name it), which made `openapi.json` fail OAS 3.0.3 `uniqueItems` and
 * aborted `openapi-python-client` (2026-09-18 evaluation, J9-1). */
export const RUN_FAILURE_CODES: readonly RunFailureCode[] = [
  ...new Set(FAILURE_CODES_WITH_OVERLAPS),
];

/**
 * The failures a later run of the same binding cannot outwait: the author's
 * own node, a connector that refuses, a model reply that never fits the
 * schema, and the organization's provider account (a rejected or missing
 * key, spent credit, a model the provider does not serve). Only these count
 * toward a trigger's failure streak — a rate limit, an unreachable provider,
 * an agent turn that crashed or ran out of time may well pass at the next
 * occurrence, so they neither count nor break the streak.
 */
export const PERMANENT_FAILURE_CODES = [
  'node_error',
  'connector_error',
  'llm_output_invalid',
  'auth_error',
  'missing_api_key',
  'credit_exhausted',
  'model_not_found',
] as const satisfies readonly RunFailureCode[];

const PERMANENT_FAILURE_CODE_SET: ReadonlySet<string> = new Set(
  PERMANENT_FAILURE_CODES,
);

/** Whether a failed run's code is one the next occurrence would repeat. */
export function isPermanentFailureCode(
  code: string | null | undefined,
): boolean {
  return (
    code !== null && code !== undefined && PERMANENT_FAILURE_CODE_SET.has(code)
  );
}

/**
 * Permanent failures in a row after which a schedule turns itself off and
 * the organization's owners and admins are told. A schedule is the one
 * binding the platform fires by itself, so nothing else stops one that
 * fails the same way at every occurrence (one did 5,370 times in ten days,
 * #3092); five leaves room for a failure that only looked permanent.
 */
export const PERMANENT_FAILURES_BEFORE_PAUSE = 5;

/**
 * A node failure that knows its cause. Thrown at the sites that can tell —
 * a connector refusal, a rejected approval, the execution guard, an agent
 * turn that exhausted its retries — and read by the stepper's one catch, so
 * the code travels to `finishRun` without every site learning the wire.
 */
export class NodeFailure extends Error {
  readonly code: RunFailureCode;
  readonly hint: string | undefined;

  constructor(code: RunFailureCode, message: string, hint?: string) {
    super(message);
    this.name = 'NodeFailure';
    this.code = code;
    this.hint = hint;
  }
}

/**
 * A failure that ends the run at the node that raised it, whatever the node's
 * `onError` says: a person decided the run must stop there (they chose to
 * fail it at a write that may already have happened). Inside a
 * subautomation it ends the calling node too, instead of being folded into
 * "subautomation … failed".
 */
export class RunStopFailure extends Error {
  readonly code: RunFailureCode;

  constructor(code: RunFailureCode, message: string) {
    super(message);
    this.name = 'RunStopFailure';
    this.code = code;
  }
}

const RUN_FAILURE_CODE_SET: ReadonlySet<string> = new Set(RUN_FAILURE_CODES);

/** Whether a stored string is a code `Run.failureCode` can carry. */
export function isRunFailureCode(value: unknown): value is RunFailureCode {
  return typeof value === 'string' && RUN_FAILURE_CODE_SET.has(value);
}

/**
 * The code for an error the stepper caught: a `NodeFailure` names its own;
 * anything else is classified the way the chat surface classifies a
 * provider failure — a status number or a `"code":` in the sentence names
 * the provider bucket — and falls to `node_error` when it is not one.
 */
export function runFailureCodeOf(error: unknown): RunFailureCode {
  if (error instanceof NodeFailure || error instanceof RunStopFailure) {
    return error.code;
  }
  const chat = classifyChatErrorCode(error);
  return (PROVIDER_FAILURE_CODES as readonly string[]).includes(chat)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the membership test above
      (chat as RunFailureCode)
    : 'node_error';
}

/** The run code for an agent settle's own failure code — the agent
 * vocabulary is on the wire as it is, but for the retry-only codes, which
 * report as the code they refine ({@link AGENT_RETRY_ONLY_CODES}); anything
 * else (or nothing) is the harness bucket. */
export function agentFailureCodeOf(
  value: string | null | undefined,
): RunFailureCode {
  if (value === null || value === undefined) return 'harness_error';
  if ((AGENT_FAILURE_CODES as readonly string[]).includes(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the membership test above
    return value as RunFailureCode;
  }
  return AGENT_RETRY_ONLY_CODE_MAP.get(value) ?? 'harness_error';
}
