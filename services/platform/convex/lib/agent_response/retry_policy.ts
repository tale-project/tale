import type { GenerateResponseResult } from './types';

/**
 * Merge usage stats from two LLM calls.
 * Used when retrying with empty text.
 */
export function mergeUsage(
  usage1?: GenerateResponseResult['usage'],
  usage2?: GenerateResponseResult['usage'],
): GenerateResponseResult['usage'] {
  if (!usage1) return usage2;
  if (!usage2) return usage1;
  return {
    inputTokens: (usage1.inputTokens ?? 0) + (usage2.inputTokens ?? 0),
    outputTokens: (usage1.outputTokens ?? 0) + (usage2.outputTokens ?? 0),
    totalTokens: (usage1.totalTokens ?? 0) + (usage2.totalTokens ?? 0),
    reasoningTokens:
      (usage1.reasoningTokens ?? 0) + (usage2.reasoningTokens ?? 0),
    cachedInputTokens:
      (usage1.cachedInputTokens ?? 0) + (usage2.cachedInputTokens ?? 0),
  };
}

/**
 * Determine if a retry is needed because tools were called but no
 * substantive follow-up text was generated.
 *
 * Catches two scenarios:
 * 1. Text is completely empty (LLM stopped right after tool calls)
 * 2. Text exists but is only a preamble before tool calls (e.g., "Let me check...")
 *    with no actual response incorporating the tool results
 */
export function needsToolResultRetry(
  text: string | undefined,
  steps: unknown[] | undefined,
): boolean {
  if (!steps || steps.length === 0) return false;

  // Completely empty text always needs retry if there were steps
  if (!text?.trim()) return true;

  type StepLike = { toolCalls?: Array<{ toolName: string }>; text?: string };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  const typedSteps = steps as StepLike[];
  const hasToolSteps = typedSteps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (!hasToolSteps) return false;

  const lastStep = typedSteps[typedSteps.length - 1];
  const lastStepHasToolCalls = (lastStep?.toolCalls?.length ?? 0) > 0;
  const lastStepText = lastStep?.text?.trim() ?? '';

  // Retry if:
  // - The last step itself has tool calls (response ended mid-tool-execution,
  //   LLM output like "Let me check..." is just preamble before tool calls)
  // - The last step (follow-up after tool results) has no text
  return lastStepHasToolCalls || !lastStepText;
}

/**
 * The interactive approval-gate tool. When the agent loop is halted because the
 * model called this (see the `stopWhen: hasToolCall('request_human_input')` in
 * generate_response.ts), the stop is INTENTIONAL — an approval card is now shown
 * and the turn must wait for the user's response in a future turn.
 */
const HUMAN_INPUT_GATE_TOOL = 'request_human_input';

/**
 * True when the generation's LAST step ended by calling `request_human_input`.
 *
 * That is the deliberate approval-gate halt and MUST be treated as terminal: the
 * AI SDK reports `finishReason: 'tool-calls'` for it (or `'stop'` with no
 * trailing text), which the retry logic below would otherwise read as an
 * incomplete response and auto-continue — barrelling straight past the gate the
 * stop exists to enforce (researcher plan-confirmation, disambiguation cards…).
 *
 * Scoped to the LAST step: when `stopWhen` fires, the gate call is always the
 * final step. A gate call in an earlier step (the model kept going on its own)
 * is not a gate halt and stays retryable.
 */
export function endedOnHumanInputGate(steps: unknown[] | undefined): boolean {
  if (!steps || steps.length === 0) return false;
  type StepLike = { toolCalls?: Array<{ toolName: string }> };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  const typedSteps = steps as StepLike[];
  const lastStep = typedSteps[typedSteps.length - 1];
  return (lastStep?.toolCalls ?? []).some(
    (call) => call.toolName === HUMAN_INPUT_GATE_TOOL,
  );
}

/**
 * Finish reasons that indicate a completed or non-retryable state.
 * - "stop": normal LLM completion
 * - "cancelled": user explicitly cancelled the generation
 * - "timeout-recovery" / "timeout-recovery-failed": already a recovery attempt
 */
const NON_RETRYABLE_FINISH_REASONS = new Set([
  'stop',
  'cached',
  'cancelled',
  'content-filter',
  'error',
  'timeout-recovery',
  'timeout-recovery-failed',
]);

/**
 * Determine whether the generation result should be retried based on
 * `finishReason`. Only `"stop"` (and other non-retryable custom reasons)
 * counts as a successful completion. All other finish reasons — `"length"`,
 * `"tool-calls"`, `"content-filter"`, `"unknown"`, `undefined`, etc. —
 * trigger a single retry without tools.
 *
 * Special case: `finishReason === "stop"` with empty text after tool calls
 * (known DeepSeek edge case) still triggers a retry.
 */
export function shouldRetryGeneration(
  finishReason: string | undefined,
  text: string | undefined,
  steps: unknown[] | undefined,
  alreadyRetried: boolean,
): { retry: boolean; reason: string } {
  if (alreadyRetried) return { retry: false, reason: 'already-retried' };

  // The approval gate (`request_human_input`) halts the loop on purpose — the
  // turn must wait for the user, not auto-continue. Treat it as terminal no
  // matter the finishReason ('tool-calls' when stopWhen fires, or 'stop' with
  // empty trailing text), so the continue path never resumes past the gate.
  if (endedOnHumanInputGate(steps)) {
    return { retry: false, reason: 'awaiting-human-input' };
  }

  if (finishReason && NON_RETRYABLE_FINISH_REASONS.has(finishReason)) {
    if (finishReason === 'stop' && needsToolResultRetry(text, steps)) {
      return { retry: true, reason: 'stop-with-empty-tool-result' };
    }
    return { retry: false, reason: 'non-retryable-finish-reason' };
  }

  return {
    retry: true,
    reason: `finish-reason-${finishReason ?? 'undefined'}`,
  };
}
