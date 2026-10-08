import type { AgentRunWaitingReason } from '../../../lib/shared/agent-run-waiting';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { CapacityRefusal } from '../node_only/sandbox/capacity_refusal';

/**
 * The `reason` a slot refusal carries when the one workspace a run would
 * start in already holds a live session of its own (the per-session cap of
 * `reserveSessionSlot`). Not the organization's budget: with one run per
 * worker it only meets a start that raced another start of the same worker
 * (a rolling deploy's old image, a duplicate job), so the run waits without
 * blaming the organization's limit.
 */
export const SANDBOX_SESSION_HELD_REASON = 'session_held';

/**
 * Why a project agent's run that met no room waits — what its park stores
 * (`waiting_reason`). `noRoom` is the capacity refusal the start met, or null
 * for a refusal because the workspace's Destroy is pending (the caller has
 * judged the error to be one of the two). Undefined when the refusal has no
 * wording of its own: the run reads as generically waiting.
 */
export function runParkReason(
  err: unknown,
  noRoom: CapacityRefusal | null,
): AgentRunWaitingReason | undefined {
  if (noRoom === null) return 'destroy_pending';
  switch (noRoom.scope) {
    case 'host':
      return 'host';
    case 'session':
      return 'exec_limit';
    case 'organization':
      return refusalReason(err) === SANDBOX_SESSION_HELD_REASON
        ? undefined
        : 'org_limit';
  }
}

/** The `reason` a quota refusal names, in each shape one arrives in: an
 * AppError whose data names it, the sessions domain's own error, or either
 * wrapped into a plain Error whose message carries the payload. */
function refusalReason(err: unknown): string | undefined {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    return typeof data === 'object' &&
      data !== null &&
      'reason' in data &&
      typeof data.reason === 'string'
      ? data.reason
      : undefined;
  }
  if (!(err instanceof Error)) return undefined;
  if ('reason' in err && typeof err.reason === 'string') return err.reason;
  return /"reason":"([a-z_]+)"/.exec(err.message)?.[1];
}
