/**
 * Execute Step Handler - Business Logic
 *
 * Contains the business logic for executing a single workflow step.
 */

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { replaceVariables } from '../../../lib/variables/replace_variables';
import type { StepType } from '../data_source/types';
import { buildUserAnswers } from '../nodes/llm/utils/build_human_input_context';
import { buildStepsMap } from '../step_execution/build_steps_map';
import { executeStepByType } from '../step_execution/execute_step_by_type';
import { extractEssentialLoopVariables } from '../step_execution/extract_essential_loop_variables';
import { getActiveLoopProgress } from '../step_execution/get_active_loop_progress';
import { initializeExecutionVariables } from '../step_execution/initialize_execution_variables';
import { loadAndValidateExecution } from '../step_execution/load_and_validate_execution';
import { persistExecutionResult } from '../step_execution/persist_execution_result';
import { buildWorkflowUserProfile } from './build_workflow_user_profile';
import { mergeWorkflowLevelLLMModels } from './merge_workflow_llm_models';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export type ExecuteStepArgs = {
  organizationId: string;
  executionId: string;
  stepSlug: string;
  stepType: StepType;
  stepName?: string;
  threadId?: string;
  initialInput?: unknown;
  resumeVariables?: unknown;
};

export type ExecuteStepResult = {
  port: string;
  error?: string;
  approvalTaskId?: string;
};

/**
 * Handle execution of a single workflow step
 */
export async function handleExecuteStep(
  ctx: ActionCtx,
  args: ExecuteStepArgs,
): Promise<ExecuteStepResult> {
  // 1. Load and validate execution data
  const { execution, stepConfig, workflowConfig } =
    await loadAndValidateExecution(ctx, args.executionId, args.stepSlug);

  // 2. Build step definition
  const stepDef = {
    stepSlug: args.stepSlug,
    name: args.stepName || args.stepSlug,
    stepType: args.stepType,
    config: stepConfig,
    organizationId: args.organizationId,
  };

  // 3. Initialize and merge variables
  const fullVariables = await initializeExecutionVariables(
    ctx,
    execution,
    {
      executionId: args.executionId,
      organizationId: args.organizationId,
      resumeVariables: args.resumeVariables,
      initialInput: args.initialInput,
    },
    workflowConfig,
  );

  // 4. Update current step for real-time progress tracking (after variable init so loop context is available)
  const loopProgress = getActiveLoopProgress(fullVariables.loop);

  await ctx.runMutation(
    internal.wf_executions.internal_mutations.updateExecutionStatus,
    {
      executionId: toId<'wfExecutions'>(args.executionId),
      status: 'running',
      currentStepSlug: args.stepSlug,
      currentStepName: args.stepName || args.stepSlug,
      loopProgress,
    },
  );

  // 5. Process config with variable replacement
  // Special handling for set_variables action: skip pre-processing to allow
  // sequential variable resolution within the action itself
  const isSetVariablesAction =
    args.stepType === 'action' &&
    isRecord(stepDef.config) &&
    stepDef.config.type === 'set_variables';

  // Debug: Log loop variables before processing
  if (isRecord(fullVariables.loop)) {
    debugLog('handleExecuteStep Loop variables before processing:', {
      stepSlug: args.stepSlug,
      loopIndex: fullVariables.loop.index,
      loopState: fullVariables.loop.state,
      hasParent: !!fullVariables.loop.parent,
    });
  }

  // Debug: Log before variable replacement for LLM steps
  if (args.stepType === 'llm' && isRecord(stepDef.config)) {
    const llmConfig = stepDef.config;
    const stepsData = isRecord(fullVariables.steps)
      ? fullVariables.steps
      : undefined;

    debugLog('Before replaceVariables (LLM step):', {
      stepSlug: args.stepSlug,
      hasUserPrompt: !!llmConfig.userPrompt,
      userPromptLength:
        typeof llmConfig.userPrompt === 'string'
          ? llmConfig.userPrompt.length
          : 0,
      userPromptPreview:
        typeof llmConfig.userPrompt === 'string'
          ? llmConfig.userPrompt.slice(0, 100)
          : '',
      hasTemplateMarkers: /\{\{/.test(
        typeof llmConfig.userPrompt === 'string' ? llmConfig.userPrompt : '',
      ),
      availableVariableKeys: Object.keys(fullVariables),
      stepsKeys: stepsData ? Object.keys(stepsData) : [],
    });

    // Log currentConversation variables
    debugLog('Conversation variables:', {
      currentConversationId: fullVariables.currentConversationId,
      currentConversationSubject: fullVariables.currentConversationSubject,
      currentConversationType: fullVariables.currentConversationType,
    });
  }

  // Build userAnswers and userProfile for LLM steps so {{userAnswers}} and
  // {{userProfile}} are available during config-level variable substitution.
  // These are ephemeral — only used for replaceVariables, NOT persisted into
  // execution state (see persistExecutionResult).
  let configVariables = fullVariables;
  if (args.stepType === 'llm' && args.executionId) {
    const [userAnswers, userProfile] = await Promise.all([
      buildUserAnswers(ctx, args.executionId),
      buildWorkflowUserProfile(ctx, args.organizationId, fullVariables.userId),
    ]);
    configVariables = { ...fullVariables, userAnswers, userProfile };
  }

  const processedConfig = isSetVariablesAction
    ? stepDef.config
    : replaceVariables(stepDef.config, configVariables);

  // Debug: Log after variable replacement for LLM steps
  if (args.stepType === 'llm' && isRecord(processedConfig)) {
    debugLog('After replaceVariables (LLM step):', {
      stepSlug: args.stepSlug,
      userPromptLength:
        typeof processedConfig.userPrompt === 'string'
          ? processedConfig.userPrompt.length
          : 0,
      userPromptPreview:
        typeof processedConfig.userPrompt === 'string'
          ? processedConfig.userPrompt.slice(0, 100)
          : '',
      systemPromptLength:
        typeof processedConfig.systemPrompt === 'string'
          ? processedConfig.systemPrompt.length
          : 0,
    });
  }

  // Debug: Log resolved cursor for sync cursor steps
  if (
    args.stepType === 'action' &&
    isRecord(processedConfig) &&
    isRecord(processedConfig.parameters) &&
    processedConfig.parameters.operation === 'update_email_sync_cursor'
  ) {
    debugLog('update_sync_cursor resolved params:', {
      stepSlug: args.stepSlug,
      cursor: processedConfig.parameters.cursor,
      cursorType: typeof processedConfig.parameters.cursor,
    });
  }

  // For LLM steps, inherit workflow-level `config.models` when the step
  // defines neither `model` nor `models`. Mirrors retryPolicy inheritance.
  const finalConfig =
    args.stepType === 'llm'
      ? mergeWorkflowLevelLLMModels(
          processedConfig,
          workflowConfig.config?.models,
        )
      : processedConfig;

  const processedStepDef = { ...stepDef, config: finalConfig };

  // 6. Execute step by type
  const result = await executeStepByType(
    ctx,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    processedStepDef as {
      stepSlug: string;
      name: string;
      stepType: typeof args.stepType;
      config: Record<string, unknown>;
      organizationId: typeof args.organizationId;
    },
    fullVariables,
    args.executionId,
    args.threadId,
  );

  // 7. Post-step approval scan: a pending approval keyed to THIS step pauses
  // the execution (awaitEvent in the dynamic handler) until a human responds.
  // Two producers exist:
  //  - LLM steps configured with the request_human_input tool
  //    (resourceType 'human_input_request'),
  //  - the approval action's blocking request_review operation — the
  //    task-ops review gate (resourceType 'task_review').
  let approvalTaskId: string | undefined;
  const expectsHumanInput =
    args.stepType === 'llm' && stepHasHumanInputTool(stepConfig);
  const expectsTaskReview =
    args.stepType === 'action' && stepIsRequestReviewAction(stepConfig);
  if (expectsHumanInput || expectsTaskReview) {
    const pendingApprovals = await ctx.runQuery(
      internal.approvals.internal_queries.listPendingForExecution,
      { executionId: toId<'wfExecutions'>(args.executionId) },
    );
    const blockingResourceType = expectsHumanInput
      ? 'human_input_request'
      : 'task_review';
    const blockingApproval = pendingApprovals.find(
      (a: { resourceType: string; stepSlug?: string }) =>
        a.resourceType === blockingResourceType && a.stepSlug === args.stepSlug,
    );
    if (blockingApproval) {
      approvalTaskId = blockingApproval._id;
    }
  }

  // 8. Build steps map
  const stepsMap = await buildStepsMap(ctx, args.executionId, stepDef, result);

  // 9. Extract essential loop variables
  const essentialLoop = extractEssentialLoopVariables(result.variables);

  // 10. Persist execution result
  await persistExecutionResult(
    ctx,
    args.executionId,
    fullVariables,
    result,
    stepDef,
    stepsMap,
    essentialLoop,
  );

  // 11. Return essential control information
  return {
    port: result.port,
    error: result.error,
    approvalTaskId,
  };
}

function stepHasHumanInputTool(
  config: Record<string, unknown> | undefined,
): boolean {
  if (!config) return false;
  const tools = config.tools;
  if (!Array.isArray(tools)) return false;
  return tools.includes('request_human_input');
}

/** Action steps shaped {type: 'approval', parameters: {operation: 'request_review'}}. */
function stepIsRequestReviewAction(
  config: Record<string, unknown> | undefined,
): boolean {
  if (!config || config.type !== 'approval') return false;
  const parameters = config.parameters;
  if (!isRecord(parameters)) return false;
  return parameters.operation === 'request_review';
}
