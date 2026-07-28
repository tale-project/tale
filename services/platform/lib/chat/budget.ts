/**
 * The context-window budget, resolved once per turn.
 *
 * The window is the model's own context size, optionally shrunk by the
 * organization's governance cap (`feature_flags.maxContextTokens`). On top of
 * that sits a hard HISTORY ceiling: a million-token window filled with
 * history is a cost amplifier, not a feature — beyond this cap, older turns
 * are dropped (with the in-context notice) exactly as if the window ended
 * there. Pure data — no Convex, no I/O.
 */

/** History never budgets beyond this many tokens, whatever the window. */
export const MAX_HISTORY_BUDGET_TOKENS = 96_000;

/** The effective context window: the model's, shrunk by a positive
 * governance cap when one applies. */
export function resolveEffectiveWindow(input: {
  contextWindow: number;
  governanceMaxContext?: number | null;
}): number {
  const cap = input.governanceMaxContext;
  if (typeof cap === 'number' && cap > 0) {
    return Math.min(input.contextWindow, cap);
  }
  return input.contextWindow;
}
