/**
 * Load and validate execution data
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { LoadExecutionResult } from './types';
import { deserializeVariablesInAction } from '../../helpers/serialization/deserialize_variables';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export async function loadAndValidateExecution(
  ctx: ActionCtx,
  executionId: string,
  stepSlug: string,
): Promise<LoadExecutionResult> {
  // Load execution to get wfDefinitionId and workflowConfig
  const execution = await ctx.runQuery(internal.wf_executions.queries.getExecution, {
    executionId: executionId as Id<'wfExecutions'>,
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  // If variables contain a storage reference, fetch from storage
  let variables = execution.variables;
  if (
    variables &&
    typeof variables === 'object' &&
    '_storageRef' in variables
  ) {
    debugLog('loadAndValidateExecution Variables in storage, fetching...');
    // Get the raw execution to access the serialized variables string
    const rawExecution = await ctx.runQuery(
      internal.wf_executions.queries.getRawExecution,
      { executionId: executionId as Id<'wfExecutions'> },
    );
    if (rawExecution?.variables) {
      variables = await deserializeVariablesInAction(
        ctx,
        rawExecution.variables,
      );
    }
  }

  // Load stepConfig from execution.stepsConfig
  const stepConfigRaw = execution.stepsConfig?.[stepSlug];

  if (!stepConfigRaw) {
    throw new Error(
      `Step config not found for stepSlug: ${stepSlug} in execution ${executionId}`,
    );
  }

  // Get workflowConfig from execution
  const workflowConfig = execution.workflowConfig || {};

  return {
    execution: {
      ...execution,
      variables,
    } as LoadExecutionResult['execution'],
    stepConfig: stepConfigRaw as { [key: string]: unknown },
    workflowConfig: workflowConfig as {
      name?: string;
      description?: string;
      version?: string;
      workflowType?: 'predefined';
      config?: {
        variables?: Record<string, unknown>;
        secrets?: Record<
          string,
          { kind: 'inlineEncrypted'; cipherText: string; keyId?: string }
        >;
      };
    },
  };
}
