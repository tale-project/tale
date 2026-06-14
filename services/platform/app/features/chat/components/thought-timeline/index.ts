/**
 * The chat "thought process" UI — the header strip, the live gap-shell
 * indicator, and the inline reasoning/tool/routing rows.
 *
 * This barrel re-exports ONLY the public surface other modules consume, so the
 * folder's internal split (header vs rows vs timer vs helpers) can change freely
 * without touching import sites:
 *   - `ThinkingIndicator`   → chat-messages.tsx (the pre-bubble gap affordance)
 *   - `MessageThoughtHeader`→ message-bubble.tsx (the in-bubble status strip)
 *   - `InlineReasoning` / `ToolStepRow` / `RoutingStepRow` / `STEP_INDENT`
 *                            → message-segments.tsx (the inline detail rows)
 *   - `ThinkingDots`        → message-bubble.tsx (the trailing "still working"
 *                             affordance at the end of a streaming message)
 */

export { InlineReasoning } from './inline-reasoning';
export { MessageThoughtHeader } from './message-thought-header';
export { RoutingStepRow, STEP_INDENT, ToolStepRow } from './step-rows';
export { ThinkingDots } from './thinking-dots';
export { ThinkingIndicator } from './thinking-indicator';
