/**
 * LLM Result Creation
 *
 * Creates StepExecutionResult for LLM node with metadata.
 * Supports workflow termination protocol.
 */

import type { StepExecutionResult } from '../../../../types';
import type { NormalizedConfig, LLMExecutionResult } from '../types';
import { isTerminationSignal } from '../types/workflow_termination';

/**
 * Creates LLM step execution result with metadata
 * Supports workflow termination protocol
 */
export function createLLMResult(
  llmResult: LLMExecutionResult,
  config: NormalizedConfig,
  args: { threadId?: string },
): StepExecutionResult {
  // Check if LLM output contains a termination signal
  const shouldTerminate = isTerminationSignal(llmResult.finalOutput);

  // Attach LLM-specific metadata into output.meta (not variables)
  const meta = {
    ...(config.contextVariables ?? {}),
    llm: {
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      threadId: args.threadId ?? null,
      output: llmResult.finalOutput,
      toolsAvailable: config.tools?.length || 0,
      convexToolsCount: config.tools?.length || 0,
      agentStep: llmResult.agentSteps,
      lastToolName: llmResult.toolDiagnostics.lastToolName,
      lastToolInputText: llmResult.toolDiagnostics.lastToolInputText,
      lastToolResultText: llmResult.toolDiagnostics.lastToolResultText,
      terminated: shouldTerminate, // Flag indicating workflow termination
    },
  };

  // Always use 'success' port; workflows no longer rely on a special 'terminate' port
  const port = 'success' as const;

  return {
    port,
    output: {
      type: 'llm',
      data: llmResult.finalOutput,
      meta,
    },
    threadId: args.threadId,
  };
}
