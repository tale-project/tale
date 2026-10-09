/**
 * Why a project agent's run waits for room instead of starting — what a
 * parked run keeps in `project_agent_runs.waiting_reason` (migration 0167)
 * and what every read of it carries while it waits:
 *
 * - `org_limit` — every one of the organization's agent workers is in use
 *   (its "Agent workers" sandbox limit); an Owner or Admin can raise it.
 * - `host` — the sandbox host is full, or short of memory or disk.
 * - `destroy_pending` — an administrator is deleting the workspace the run
 *   would use; it starts in a fresh one once that is done.
 * - `exec_limit` — its sandbox still runs as many processes as it may (an
 *   earlier process is ending).
 *
 * A park written before the column, or one whose cause has no wording of
 * its own, has none: the reader shows the generic waiting state.
 *
 * Layer A: pure data.
 */
export const AGENT_RUN_WAITING_REASONS = [
  'org_limit',
  'host',
  'destroy_pending',
  'exec_limit',
] as const;

export type AgentRunWaitingReason = (typeof AGENT_RUN_WAITING_REASONS)[number];

/** Whether a stored value is one of the reasons above. */
export function isAgentRunWaitingReason(
  value: unknown,
): value is AgentRunWaitingReason {
  return (
    typeof value === 'string' &&
    (AGENT_RUN_WAITING_REASONS as readonly string[]).includes(value)
  );
}
