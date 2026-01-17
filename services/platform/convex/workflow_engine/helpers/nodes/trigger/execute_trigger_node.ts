/**
 * Trigger Node Executor - Helper Function
 *
 * Handles workflow trigger execution including manual, scheduled, webhook, and event triggers.
 */

import { StepExecutionResult } from '../../../types';
import {
  processTriggerConfig,
  TriggerConfig,
} from './process_trigger_config.js';
import type { Id } from '../../../../_generated/dataModel';

// =============================================================================
// HELPER FUNCTION
// =============================================================================

/**
 * Execute trigger node logic (helper function)
 */
export async function executeTriggerNode(
  config: TriggerConfig,
  variables: Record<string, unknown>,
  executionId: string | Id<'wfExecutions'>,
  threadId?: string,
): Promise<StepExecutionResult> {
  const triggerType = config.type;

  // Initialize trigger context
  const triggerContext = {
    triggerType,
    timestamp: Date.now(),
    executionId,
  };

  // Process trigger based on type
  const triggerResult = await processTriggerConfig(config, variables);

  // Attach trigger context and derived data to output.meta; do not mutate variables
  const meta = {
    trigger: triggerContext,
    ...triggerResult.variables,
  } as Record<string, unknown>;

  return {
    port: 'success',
    output: {
      type: 'trigger',
      data: `Trigger executed successfully: ${triggerType}`,
      meta,
    },
    threadId,
  };
}
