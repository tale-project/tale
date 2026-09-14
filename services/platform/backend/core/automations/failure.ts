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
 *   `automation_deleted` (the automation vanished mid-flight);
 * - an `llm` node's provider, reusing the chat surface's own vocabulary —
 *   `credit_exhausted`, `auth_error`, `rate_limited`, `provider_unreachable`,
 *   `provider_error`, …: the account or the provider, not the request;
 * - an `agent` node's turn, after the in-node retries — `harness_error`,
 *   `turn_crashed`, `session_gone`, `deadline`, `ask_expired`,
 *   `budget_exceeded`, ….
 */
export const ENGINE_FAILURE_CODES = [
  'node_error',
  'connector_error',
  'llm_output_invalid',
  'approval_rejected',
  'execution_limit',
  'automation_deleted',
] as const;

export const AGENT_FAILURE_CODES = [
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

/** Every value `Run.failureCode` can carry — the OpenAPI enum. */
export const RUN_FAILURE_CODES = [
  ...ENGINE_FAILURE_CODES,
  ...PROVIDER_FAILURE_CODES,
  ...AGENT_FAILURE_CODES,
] as const;

export type RunFailureCode = (typeof RUN_FAILURE_CODES)[number];

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
 * The code for an error the stepper caught: a `NodeFailure` names its own;
 * anything else is classified the way the chat surface classifies a
 * provider failure — a status number or a `"code":` in the sentence names
 * the provider bucket — and falls to `node_error` when it is not one.
 */
export function runFailureCodeOf(error: unknown): RunFailureCode {
  if (error instanceof NodeFailure) return error.code;
  const chat = classifyChatErrorCode(error);
  return (PROVIDER_FAILURE_CODES as readonly string[]).includes(chat)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the membership test above
      (chat as RunFailureCode)
    : 'node_error';
}

/** The run code for an agent settle's own failure code — the agent
 * vocabulary is a subset of the run's; anything else (or nothing) is the
 * harness bucket. */
export function agentFailureCodeOf(
  value: string | null | undefined,
): RunFailureCode {
  return value !== null &&
    value !== undefined &&
    (AGENT_FAILURE_CODES as readonly string[]).includes(value)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the membership test above
      (value as RunFailureCode)
    : 'harness_error';
}
