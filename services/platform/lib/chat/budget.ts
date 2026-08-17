/**
 * The context-window budget, resolved once per turn.
 *
 * The window is the model's own context size, optionally shrunk by the
 * organization's governance cap (`feature_flags.maxContextTokens`). Those
 * two are the ONLY ceilings: capability comes from the catalog declaration,
 * cost control from the governance cap — never from a constant here. Pure
 * data — no Convex, no I/O.
 */

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
