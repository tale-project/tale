/**
 * Custom stop conditions for the agent tool loop.
 *
 * `hasValidToolCall` replaces the AI SDK's `hasToolCall` for the
 * `request_human_input` approval gate. The SDK matcher fires on tool NAME
 * alone — including calls whose input failed schema validation (the SDK marks
 * them `invalid: true` but leaves them in `step.toolCalls`). An invalid call
 * never executed, so no approval card exists; halting on it strands the turn
 * with no card, no retry, and only the generic fallback text. Stopping only on
 * a VALID call lets the model see the tool-error result and correct its
 * arguments on the next step.
 */

import type { StopCondition, ToolSet } from 'ai';

export function hasValidToolCall<TOOLS extends ToolSet>(
  toolName: string,
): StopCondition<TOOLS> {
  return ({ steps }) =>
    (steps[steps.length - 1]?.toolCalls ?? []).some(
      (toolCall) =>
        toolCall.toolName === toolName &&
        !('invalid' in toolCall && toolCall.invalid === true),
    );
}
