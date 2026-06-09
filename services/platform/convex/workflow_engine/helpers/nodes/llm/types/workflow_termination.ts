/**
 * Workflow Termination Protocol
 *
 * Defines the standard protocol for LLM agents to signal workflow termination.
 * This allows agents to intelligently decide when a workflow should end early
 * (e.g., when no data is found to process).
 */

import { v } from 'convex/values';

import { isRecord } from '../../../../../../lib/utils/type-guards';
import { renderPrompt } from '../../../../../lib/prompts/registry';
import { jsonRecordValidator } from '../../../../../lib/validators/json';

const TERMINATION_TYPES = [
  'NO_DATA_FOUND',
  'CONDITION_NOT_MET',
  'EARLY_EXIT',
] as const;

type TerminationType = (typeof TERMINATION_TYPES)[number];

/** Standard termination signal that LLM agents can return. */
interface WorkflowTerminationSignal {
  shouldTerminate: true;
  reason: string;
  terminationType: TerminationType;
  metadata?: Record<string, unknown>;
}

export const workflowTerminationSignalValidator = v.object({
  shouldTerminate: v.literal(true),
  reason: v.string(),
  terminationType: v.union(
    v.literal('NO_DATA_FOUND'),
    v.literal('CONDITION_NOT_MET'),
    v.literal('EARLY_EXIT'),
  ),
  metadata: v.optional(jsonRecordValidator),
});

function isTerminationType(value: unknown): value is TerminationType {
  return (
    typeof value === 'string' &&
    (TERMINATION_TYPES as readonly string[]).includes(value)
  );
}

/** Check if LLM output contains a termination signal. */
export function isTerminationSignal(
  output: unknown,
): output is WorkflowTerminationSignal {
  return (
    isRecord(output) &&
    output.shouldTerminate === true &&
    typeof output.reason === 'string' &&
    isTerminationType(output.terminationType)
  );
}

/** Standard prompt instruction for agents that can terminate workflows. */
export const TERMINATION_PROMPT_INSTRUCTION = renderPrompt(
  'workflow.termination',
);
