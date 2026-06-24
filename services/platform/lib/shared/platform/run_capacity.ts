/**
 * A subject's latest run is "parked on sandbox capacity" when it is still active
 * (pending/running) AND carries the sticky `awaitingCapacityStepSlug` — a sandbox
 * step waiting behind the org's concurrency cap. The active-status gate stops a
 * settled run that never cleared the flag from surfacing a stale "Queued" chip.
 *
 * Pure + shared so the `getSubjectAwaitingCapacity` query and its test agree on
 * one definition. The flag is set/cleared at the sandbox admission decision in
 * `executeSandboxNode` (see `wfExecutions.awaitingCapacityStepSlug`).
 */
export function isParkedOnCapacity(
  execution:
    | { status: string; awaitingCapacityStepSlug?: string | undefined }
    | null
    | undefined,
): boolean {
  if (!execution) return false;
  if (execution.awaitingCapacityStepSlug === undefined) return false;
  return execution.status === 'running' || execution.status === 'pending';
}
