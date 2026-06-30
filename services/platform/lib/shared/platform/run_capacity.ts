/**
 * A subject's latest run is "parked on sandbox capacity" when it is still active
 * (pending/running) AND carries the sticky `awaitingCapacityStepSlug` — a sandbox
 * step waiting behind the org's concurrency cap. The active-status gate stops a
 * settled run that never cleared the flag from surfacing a stale "Queued" chip.
 *
 * Pure + shared so the `getSubjectRunIndicator` query and its test agree on one
 * definition. The flag is set/cleared at the sandbox admission decision in
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

/**
 * The single ambient indicator a subject's row should surface in place of its
 * own kanban status, derived from the subject's latest run:
 *   - `'parked'` — active and queued behind the org's sandbox concurrency cap
 *   - `'failed'` — the run ended in failure (a step errored and it stopped), so
 *     a crashed automation reads as "Failed" instead of a frozen "in_progress"
 *   - `null` — nothing to surface; the row shows its own status
 * Parked is checked first; the two are mutually exclusive anyway since a parked
 * run is still active (a `failed` run with a stale capacity slug reads as
 * failed, not parked). Pure + shared so the `getSubjectRunIndicator` query and
 * its test agree on one definition.
 */
export function deriveRunIndicator(
  execution:
    | { status: string; awaitingCapacityStepSlug?: string | undefined }
    | null
    | undefined,
): 'parked' | 'failed' | null {
  if (!execution) return null;
  if (isParkedOnCapacity(execution)) return 'parked';
  if (execution.status === 'failed') return 'failed';
  return null;
}
