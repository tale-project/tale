/**
 * A start refused for want of sandbox room, not for a fault: the
 * organization's session budget is spent (`QUOTA_EXCEEDED` from the slot
 * reserve or the cap-checked resume), or the spawner's host is at capacity
 * or short of memory (HTTP 429). Each work lane waits instead of failing —
 * the task lane parks the run, the automation lane re-kicks the node once
 * the refusal's retry hint has passed, the crawler polls for a slot —
 * because the room frees as soon as other work settles.
 *
 * A start refused because an administrator's Destroy of its session is
 * pending is a `QUOTA_EXCEEDED` too, marked `reason: 'destroy_pending'`
 * ({@link isDestroyPendingRefusal}), but no want of room: what frees is a
 * fresh, empty workspace, so each lane decides about it on its own.
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { SANDBOX_DESTROY_PENDING_REASON } from '../../sandbox/session_constants';
import {
  SpawnerBusyError,
  type SpawnerQueuePlace,
} from './helpers/session_client';

/** How long a lane waits before asking again when the refusal names no
 * retry hint: the organization's own budget frees on a release edge, so a
 * retry soon after is cheap. */
const DEFAULT_CAPACITY_RETRY_MS = 15_000;

export interface CapacityRefusal {
  /** Whose room ran out: the organization's budget, or the shared host. */
  scope: 'organization' | 'host';
  retryAfterMs: number;
  /** The start's place in the spawner's first-come line for host room, when
   * the spawner keeps one: `retryAfterMs` is then when that place comes up,
   * and a lane comes back exactly then rather than after a backoff of its
   * own — later, and the waiters behind it take the room. */
  queue?: SpawnerQueuePlace;
}

/** When a refused start should be woken, or undefined to leave it to the
 * release edges and the watchdog: only a host that keeps a first-come line
 * says when the start's place comes up. An organization's own budget frees
 * on its release edge, and an older host's fixed hint would only make every
 * waiter ask in lockstep. */
export function queuedWakeAfterMs(
  refusal: CapacityRefusal,
): number | undefined {
  return refusal.scope === 'host' && refusal.queue !== undefined
    ? refusal.retryAfterMs
    : undefined;
}

/** The capacity refusal `err` is, or null when it is anything else — a
 * refusal for a pending Destroy included. */
export function sandboxCapacityRefusal(err: unknown): CapacityRefusal | null {
  if (err instanceof SpawnerBusyError) {
    return {
      scope: 'host',
      retryAfterMs: err.retryAfterMs ?? DEFAULT_CAPACITY_RETRY_MS,
      ...(err.queue !== undefined ? { queue: err.queue } : {}),
    };
  }
  if (quotaRefusal(err) === 'budget') {
    return { scope: 'organization', retryAfterMs: DEFAULT_CAPACITY_RETRY_MS };
  }
  return null;
}

/** Whether `err` refused a start because an administrator's Destroy of its
 * session is queued, retrying or running (the sessions domain's
 * `SandboxDestroyPendingError`), in any shape a quota refusal arrives in. */
export function isDestroyPendingRefusal(err: unknown): boolean {
  return quotaRefusal(err) === 'destroy_pending';
}

/** Which `QUOTA_EXCEEDED` refusal `err` is, or null for any other failure:
 * the shape thrown by the slot reserve and the cap-checked resume — an
 * AppError whose data names the code, the sessions domain's
 * `SandboxQuotaError` (its own `code`), or either wrapped by a sub-mutation
 * into a plain Error whose message carries the payload — marked
 * `destroy_pending` when the session's Destroy is pending, else `budget`. */
function quotaRefusal(err: unknown): 'budget' | 'destroy_pending' | null {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      !('code' in data) ||
      data.code !== 'QUOTA_EXCEEDED'
    ) {
      return null;
    }
    return 'reason' in data && data.reason === SANDBOX_DESTROY_PENDING_REASON
      ? 'destroy_pending'
      : 'budget';
  }
  if (!(err instanceof Error)) return null;
  if ('code' in err && err.code === 'QUOTA_EXCEEDED') {
    return 'reason' in err && err.reason === SANDBOX_DESTROY_PENDING_REASON
      ? 'destroy_pending'
      : 'budget';
  }
  if (!err.message.includes('QUOTA_EXCEEDED')) return null;
  return err.message.includes(`"reason":"${SANDBOX_DESTROY_PENDING_REASON}"`)
    ? 'destroy_pending'
    : 'budget';
}
