/**
 * Loop Node Executor - Helper Function
 *
 * Helper function for loop node execution.
 */

import type { Id } from '../../../../_generated/dataModel';

import { createDebugLog } from '../../../../lib/debug_log';
import { StepExecutionContext, StepExecutionResult } from '../../../types';
import { LoopNodeConfig } from '../../../types/nodes';
import { LoopNodeExecutor } from './loop_node_executor';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// =============================================================================
// HELPER FUNCTION
// =============================================================================

/**
 * Execute loop node logic (helper function)
 */
export async function executeLoopNode(
  stepSlug: string,
  config: LoopNodeConfig,
  variables: Record<string, unknown>,
  executionId: string | Id<'wfExecutions'>,
  threadId?: string,
): Promise<StepExecutionResult> {
  debugLog('LOOP ACTION executeLoopNode called for stepSlug:', stepSlug);

  const context: StepExecutionContext = {
    stepDef: {
      _id: 'loop_stub',
      wfDefinitionId: 'loop_stub_def',
      stepSlug,
      name: '',
      stepType: 'loop',
      order: 0,
      config,
      nextSteps: {},
      organizationId: '',
    },
    variables,
    executionId: executionId.toString(),
    threadId,
  };

  const res = await LoopNodeExecutor.execute(context, config);

  // Conform to the action return validator with normalized shape
  return {
    port: res.port,
    variables: res.variables,
    output: res.output,
    ...(res.error ? { error: res.error } : {}),
  };
}
