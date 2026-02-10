/**
 * Workflow Termination Protocol
 *
 * Defines the standard protocol for LLM agents to signal workflow termination.
 * This allows agents to intelligently decide when a workflow should end early
 * (e.g., when no data is found to process).
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../../../../../lib/shared/schemas/utils/json-value';
import { isRecord } from '../../../../../../lib/utils/type-guards';

/**
 * Standard termination signal that LLM agents can return
 */
export interface WorkflowTerminationSignal {
  shouldTerminate: true;
  reason: string;
  terminationType: 'NO_DATA_FOUND' | 'CONDITION_NOT_MET' | 'EARLY_EXIT';
  metadata?: Record<string, unknown>;
}

/**
 * Validator for termination signal
 */
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

/**
 * Check if LLM output contains a termination signal
 */
export function isTerminationSignal(
  output: unknown,
): output is WorkflowTerminationSignal {
  if (!isRecord(output)) {
    return false;
  }

  return (
    output.shouldTerminate === true &&
    typeof output.reason === 'string' &&
    typeof output.terminationType === 'string' &&
    ['NO_DATA_FOUND', 'CONDITION_NOT_MET', 'EARLY_EXIT'].includes(
      output.terminationType,
    )
  );
}

/**
 * Standard prompt instruction for agents that can terminate workflows
 */
export const TERMINATION_PROMPT_INSTRUCTION = `
IMPORTANT: Workflow Termination Protocol
If you determine that the workflow should not continue (e.g., no data found to process), 
you MUST return a termination signal in this exact format:

{
  "shouldTerminate": true,
  "reason": "Clear explanation of why the workflow should terminate",
  "terminationType": "NO_DATA_FOUND" | "CONDITION_NOT_MET" | "EARLY_EXIT",
  "metadata": { /* optional additional context */ }
}

Termination Types:
- NO_DATA_FOUND: No data available to process (e.g., no customers found)
- CONDITION_NOT_MET: Required conditions are not satisfied
- EARLY_EXIT: Workflow should exit early for other reasons

Only use this when the workflow genuinely should not continue.
If there is data to process, return your normal response format.
`;

/**
 * Example usage in agent prompts
 */
export const TERMINATION_EXAMPLES = {
  NO_DATA_FOUND: {
    shouldTerminate: true,
    reason:
      'No customers found that have not been processed by workflow "assess-customer-status" in the last 3 days',
    terminationType: 'NO_DATA_FOUND' as const,
    metadata: {
      searchCriteria: {
        workflowId: 'assess-customer-status',
        daysBack: 3,
        metadataPath: 'workflows.assess-customer-status.lastProcessedAt',
      },
      customersChecked: 150,
      eligibleCustomers: 0,
    },
  },
  CONDITION_NOT_MET: {
    shouldTerminate: true,
    reason: 'Customer does not meet the criteria for churn analysis',
    terminationType: 'CONDITION_NOT_MET' as const,
    metadata: {
      customerId: 'cust_123',
      missingCriteria: ['active_subscription', 'email_verified'],
    },
  },
};

/**
 * Helper to generate workflow tracking metadata path
 */
export function getWorkflowTrackingPath(workflowId: string): string {
  return `workflows.${workflowId}.lastProcessedAt`;
}

/**
 * Helper to create workflow tracking metadata update
 */
export function createWorkflowTrackingUpdate(
  workflowId: string,
  executionId: string,
): Record<string, unknown> {
  return {
    [`workflows.${workflowId}.lastProcessedAt`]: new Date().toISOString(),
    [`workflows.${workflowId}.lastExecutionId`]: executionId,
    [`workflows.${workflowId}.processCount`]: '{{increment}}', // Special marker for increment
  };
}
