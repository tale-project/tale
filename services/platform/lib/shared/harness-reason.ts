/**
 * Why a sandbox agent turn runs on the runtime (harness) it runs on — the
 * fact the host that opens the turn's op records beside its harness
 * (`app.sandbox_session_ops.harness_reason`, migration 0240), and the run's
 * details tell as one sentence. When nobody names a runtime the platform
 * chooses one, and a person reading a run needs to know which rule put it
 * where it ran.
 *
 * Browser-safe: the app and the backend import it alike.
 */

export const HARNESS_REASONS = [
  /** The agent, or the automation step, names its runtime. */
  'pinned',
  /** Nothing named one: the turn runs on the default runtime. */
  'default',
  /** Nothing named one, and the only credentials that serve the model work
   * in one runtime alone (a Claude subscription in Claude Code): the turn
   * runs there. */
  'subscription_bound',
  /** The standard-agent policy pins the runtime. */
  'policy',
] as const;

export type HarnessReason = (typeof HARNESS_REASONS)[number];

export function isHarnessReason(value: unknown): value is HarnessReason {
  return (
    typeof value === 'string' &&
    (HARNESS_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Why a project agent's turn runs on its runtime. `choice` is how the run got
 * its runtime at the kick: the agent names it (`pinned`), the standard-agent
 * policy pins it (`policy`), or the standard agent chose it automatically
 * (`automatic`) — then the serving decides: a model only a subscription
 * serves runs on the runtime that subscription is bound to, any other on the
 * default.
 */
export function agentHarnessReason(
  choice: 'pinned' | 'policy' | 'automatic',
  lane: 'gateway' | 'subscription',
): HarnessReason {
  if (choice !== 'automatic') return choice;
  return lane === 'subscription' ? 'subscription_bound' : 'default';
}
