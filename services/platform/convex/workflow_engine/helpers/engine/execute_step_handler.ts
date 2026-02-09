/**
 * Execute Step Handler - Business Logic
 *
 * Contains the business logic for executing a single workflow step.
 */

import type { Doc } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { createDebugLog } from '../../../lib/debug_log';
import { replaceVariables } from '../../../lib/variables/replace_variables';
import { buildStepsMap } from '../step_execution/build_steps_map';
import { executeStepByType } from '../step_execution/execute_step_by_type';
import { extractEssentialLoopVariables } from '../step_execution/extract_essential_loop_variables';
import { initializeExecutionVariables } from '../step_execution/initialize_execution_variables';
import { loadAndValidateExecution } from '../step_execution/load_and_validate_execution';
import { persistExecutionResult } from '../step_execution/persist_execution_result';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export type ExecuteStepArgs = {
  organizationId: string;
  executionId: string;
  stepSlug: string;
  stepType: Doc<'wfStepDefs'>['stepType'];
  stepName?: string;
  threadId?: string;
  initialInput?: unknown;
  resumeVariables?: unknown;
};

export type ExecuteStepResult = {
  port: string;
  error?: string;
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

  // 4. Process config with variable replacement
  // Special handling for set_variables action: skip pre-processing to allow
  // sequential variable resolution within the action itself
  const isSetVariablesAction =
    args.stepType === 'action' &&
    (stepDef.config as { type?: string }).type === 'set_variables';

  // Debug: Log loop variables before processing
  if (fullVariables.loop) {
    const loopVar = fullVariables.loop as Record<string, unknown>;
    debugLog('handleExecuteStep Loop variables before processing:', {
      stepSlug: args.stepSlug,
      loopIndex: loopVar.index,
      loopState: loopVar.state,
      hasParent: !!loopVar.parent,
    });
  }

  // Debug: Log before variable replacement for LLM steps
  if (args.stepType === 'llm') {
    const llmConfig = stepDef.config as Record<string, unknown>;
    const stepsData = fullVariables.steps as
      | Record<string, Record<string, unknown>>
      | undefined;

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

  const processedConfig = isSetVariablesAction
    ? stepDef.config
    : replaceVariables(stepDef.config, fullVariables);

  // Debug: Log after variable replacement for LLM steps
  if (args.stepType === 'llm') {
    const processedLlmConfig = processedConfig as Record<string, unknown>;
    debugLog('After replaceVariables (LLM step):', {
      stepSlug: args.stepSlug,
      userPromptLength:
        typeof processedLlmConfig.userPrompt === 'string'
          ? processedLlmConfig.userPrompt.length
          : 0,
      userPromptPreview:
        typeof processedLlmConfig.userPrompt === 'string'
          ? processedLlmConfig.userPrompt.slice(0, 100)
          : '',
      systemPromptLength:
        typeof processedLlmConfig.systemPrompt === 'string'
          ? processedLlmConfig.systemPrompt.length
          : 0,
    });
  }

  const processedStepDef = { ...stepDef, config: processedConfig };

  // 5. Execute step by type
  const result = await executeStepByType(
    ctx,
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

  // 6. Build steps map
  const stepsMap = await buildStepsMap(ctx, args.executionId, stepDef, result);

  // 7. Extract essential loop variables
  const essentialLoop = extractEssentialLoopVariables(result.variables);

  // 8. Persist execution result
  await persistExecutionResult(
    ctx,
    args.executionId,
    fullVariables,
    result,
    stepDef,
    stepsMap,
    essentialLoop,
  );

  // 9. Return essential control information
  return {
    port: result.port,
    error: result.error,
  };
}
