/**
 * Load and validate execution data
 */

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { deserializeVariablesInAction } from '../../helpers/serialization/deserialize_variables';
import { LoadExecutionResult } from './types';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export async function loadAndValidateExecution(
  ctx: ActionCtx,
  executionId: string,
  stepSlug: string,
): Promise<LoadExecutionResult> {
  // Load execution to get wfDefinitionId and workflowConfig
  const execution = await ctx.runQuery(
    internal.wf_executions.internal_queries.getExecution,
    {
      executionId: toId<'wfExecutions'>(executionId),
    },
  );

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
      internal.wf_executions.internal_queries.getRawExecution,
      { executionId: toId<'wfExecutions'>(executionId) },
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- execution with resolved variables matches LoadExecutionResult['execution']
    execution: {
      ...execution,
      variables,
    } as LoadExecutionResult['execution'],
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stepConfig from execution.stepsConfig is always Record<string, unknown>
    stepConfig: (isRecord(stepConfigRaw) ? stepConfigRaw : {}) as {
      [key: string]: unknown;
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflowConfig from execution is always a workflow config object
    workflowConfig: (isRecord(workflowConfig) ? workflowConfig : {}) as {
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
