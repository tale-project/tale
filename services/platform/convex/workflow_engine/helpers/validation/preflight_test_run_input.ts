/**
 * Server-side input preflight for test runs (#1484).
 *
 * Validates the tester's input against the workflow's start-node inputSchema
 * before an execution record is created, so invalid runs are rejected with
 * field-specific reasons instead of failing mid-run. Deliberately applied to
 * test runs only — production trigger paths (webhook/schedule/event) may carry
 * live payloads that predate the declared schema.
 */

import { isRecord } from '../../../../lib/utils/type-utils';
import { extractInputSchema } from '../../../agent_tools/workflows/helpers/extract_input_schema';
import { validateWorkflowInput } from './validate_workflow_input';

interface WorkflowStepLike {
  stepType: string;
  config?: Record<string, unknown>;
}

/**
 * Returns the joined, field-specific error message for an invalid test-run
 * input, or `null` when the input satisfies the start node's inputSchema
 * (or no schema is declared).
 */
export function preflightTestRunInput(
  steps: readonly WorkflowStepLike[],
  input: unknown,
): string | null {
  const startStep = steps.find((step) => step.stepType === 'start');
  const inputSchema = extractInputSchema(startStep?.config);
  const validation = validateWorkflowInput(
    isRecord(input) ? input : undefined,
    inputSchema,
  );
  if (validation.valid) return null;
  return `Invalid workflow input: ${validation.errors.join('; ')}`;
}
