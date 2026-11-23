/**
 * Why a sandbox agent turn runs on the runtime (harness) it runs on — the
 * fact the host that opens the turn's op records beside its harness
 * (`app.sandbox_session_ops.harness_reason`, migrations 0240 and 0241), and
 * the run's details tell as one sentence. When nobody names a runtime the
 * platform chooses one, and a person reading a run needs to know which rule
 * put it where it ran.
 *
 * The kick decides it, where the runtime is chosen, and a later turn of the
 * same conversation (an answered question's resume, a steer's restart)
 * records what the kick decided: deciding again later would read the rule as
 * it stands then against a runtime the kick chose under the rule as it stood
 * before (a step that began on Claude Code while it was the default).
 *
 * Browser-safe: the app and the backend import it alike.
 */

import { DEFAULT_HARNESS } from './harness-offer';

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
  /** Nothing named one, and the default runtime cannot run the model: its
   * tools work only on an API the default does not speak (a Responses-only
   * model), so the turn runs on a runtime that does. */
  'model_bound',
] as const;

export type HarnessReason = (typeof HARNESS_REASONS)[number];

export function isHarnessReason(value: unknown): value is HarnessReason {
  return (
    typeof value === 'string' &&
    (HARNESS_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Why a turn runs on `serving.harness`, decided when its runtime is chosen.
 * `choice` is how the runtime was chosen: the agent or the step names it
 * (`pinned`), the standard-agent policy pins it (`policy`), or nothing did
 * (`automatic`). Then the reason must be true of the runtime itself: the
 * default only when it IS the default runtime ({@link DEFAULT_HARNESS}); a
 * subscription's bound runtime when a subscription serves the turn; any other
 * runtime ran it because the default cannot run the model.
 */
export function agentHarnessReason(
  choice: 'pinned' | 'policy' | 'automatic',
  serving: { harness: string; lane: 'gateway' | 'subscription' },
): HarnessReason {
  if (choice !== 'automatic') return choice;
  if (serving.harness === DEFAULT_HARNESS) return 'default';
  return serving.lane === 'subscription' ? 'subscription_bound' : 'model_bound';
}
