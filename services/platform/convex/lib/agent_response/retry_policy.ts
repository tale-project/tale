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
 * model called this (see the `stopWhen: hasValidToolCall('request_human_input')`
 * in generate_response.ts), the stop is INTENTIONAL — an approval card is now
 * shown and the turn must wait for the user's response in a future turn.
 */
const HUMAN_INPUT_GATE_TOOL = 'request_human_input';

/**
 * True when the generation's LAST step ended by VALIDLY calling
 * `request_human_input`.
 *
 * That is the deliberate approval-gate halt and MUST be treated as terminal: the
 * AI SDK reports `finishReason: 'tool-calls'` for it (or `'stop'` with no
 * trailing text), which the retry logic below would otherwise read as an
 * incomplete response and auto-continue — barrelling straight past the gate the
 * stop exists to enforce (researcher plan-confirmation, disambiguation cards…).
 *
 * A call the SDK marked `invalid: true` (input failed schema validation) never
 * executed and created NO card — treating it as the gate halt would suppress
 * the retry and strand the turn on a question the user can never see. Invalid
 * calls therefore stay retryable.
 *
 * Scoped to the LAST step: when `stopWhen` fires, the gate call is always the
 * final step. A gate call in an earlier step (the model kept going on its own)
 * is not a gate halt and stays retryable.
 */
export function endedOnHumanInputGate(steps: unknown[] | undefined): boolean {
  if (!steps || steps.length === 0) return false;
  type StepLike = {
    toolCalls?: Array<{ toolName: string; invalid?: boolean }>;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data from AI SDK
  const typedSteps = steps as StepLike[];
  const lastStep = typedSteps[typedSteps.length - 1];
  return (lastStep?.toolCalls ?? []).some(
    (call) => call.toolName === HUMAN_INPUT_GATE_TOOL && call.invalid !== true,
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
 * How many step-cap continuation rounds a single turn may run after the
 * initial generation. Each round gets a fresh `maxSteps` budget, so this
 * bounds a runaway tool loop at (1 + MAX) × maxSteps LLM steps; the turn's
 * absolute deadline bounds it in time.
 */
export const MAX_STEP_CAP_CONTINUES = 3;

/**
 * Why a continuation is (or is not) warranted.
 * - 'step-cap': the loop ended mid-tool-work because `stepCountIs(maxSteps)`
 *   fired — an EXPECTED capacity stop on tool-heavy turns (pptx generation
 *   and the like), continued neutrally for up to {@link MAX_STEP_CAP_CONTINUES}
 *   rounds.
 * - 'anomaly': the provider ended the generation abnormally ('length',
 *   'unknown', `undefined`, or DeepSeek's 'stop' with empty text after tool
 *   calls) — retried ONCE with the [RESPONSE_INTERRUPTED] marker. An
 *   unlabelled finish ('other'/'unknown'/`undefined`) with substantive final
 *   text is NOT an anomaly — see {@link UNLABELLED_FINISH_REASONS}.
 */
export type ContinueKind = 'step-cap' | 'anomaly';

export interface ContinueAttempts {
  /** An anomaly retry already ran this turn (single-shot). */
  anomalyRetried: boolean;
  /** Step-cap continuation rounds already run this turn. */
  stepCapRounds: number;
}

/**
 * Finish reasons that say the provider never labelled how the generation
 * ended — they carry NO signal that the text is incomplete. The
 * openai-compatible adapter reports 'other' for a stream where no chunk had a
 * mappable `finish_reason` (its streaming initial value; some OpenRouter
 * upstreams omit the field entirely) and for any nonstandard string;
 * 'unknown' / `undefined` are the same situation on other adapters. Distinct
 * from 'length', which is a positive truncation signal and stays retryable.
 */
const UNLABELLED_FINISH_REASONS = new Set(['other', 'unknown']);

/**
 * Determine whether the generation result should be continued, and in which
 * mode. Only `"stop"` (and other non-retryable custom reasons) counts as a
 * successful completion.
 *
 * `"tool-calls"` means the step cap cut the loop mid-work (the deliberate
 * `request_human_input` halt is excluded first) — a capacity stop, not an
 * error: it may continue for multiple rounds. Every other retryable reason
 * is an anomaly and gets one retry.
 *
 * Special case: `finishReason === "stop"` with empty text after tool calls
 * (known DeepSeek edge case) still triggers an anomaly retry.
 *
 * Mirror special case: an unlabelled finish (see
 * {@link UNLABELLED_FINISH_REASONS}) with substantive final text is accepted
 * as complete — retrying a finished answer regenerates it from scratch
 * (duplicate content, doubled token spend) behind a spurious ⚠ retry marker.
 */
export function shouldRetryGeneration(
  finishReason: string | undefined,
  text: string | undefined,
  steps: unknown[] | undefined,
  attempts: ContinueAttempts,
): { retry: boolean; reason: string; kind?: ContinueKind } {
  // The approval gate (`request_human_input`) halts the loop on purpose — the
  // turn must wait for the user, not auto-continue. Treat it as terminal no
  // matter the finishReason ('tool-calls' when stopWhen fires, or 'stop' with
  // empty trailing text), so the continue path never resumes past the gate.
  if (endedOnHumanInputGate(steps)) {
    return { retry: false, reason: 'awaiting-human-input' };
  }

  if (finishReason === 'tool-calls') {
    if (attempts.stepCapRounds >= MAX_STEP_CAP_CONTINUES) {
      return {
        retry: false,
        reason: 'step-cap-rounds-exhausted',
        kind: 'step-cap',
      };
    }
    return { retry: true, reason: 'step-cap-continue', kind: 'step-cap' };
  }

  if (attempts.anomalyRetried) {
    return { retry: false, reason: 'already-retried' };
  }

  if (finishReason && NON_RETRYABLE_FINISH_REASONS.has(finishReason)) {
    if (finishReason === 'stop' && needsToolResultRetry(text, steps)) {
      return {
        retry: true,
        reason: 'stop-with-empty-tool-result',
        kind: 'anomaly',
      };
    }
    return { retry: false, reason: 'non-retryable-finish-reason' };
  }

  const unlabelled =
    !finishReason || UNLABELLED_FINISH_REASONS.has(finishReason);
  if (unlabelled && !!text?.trim() && !needsToolResultRetry(text, steps)) {
    return { retry: false, reason: 'unlabelled-finish-with-substantive-text' };
  }

  return {
    retry: true,
    reason: `finish-reason-${finishReason ?? 'undefined'}`,
    kind: 'anomaly',
  };
}
