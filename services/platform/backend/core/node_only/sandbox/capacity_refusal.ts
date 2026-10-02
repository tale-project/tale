/**
 * A start refused for want of sandbox room, not for a fault: the
 * organization's session budget is spent (`QUOTA_EXCEEDED` from the slot
 * reserve or the cap-checked resume), or the spawner's host is at capacity
 * or short of memory (HTTP 429). Each work lane waits instead of failing —
 * the task lane parks the run, the automation lane re-kicks the node once
 * the refusal's retry hint has passed, the crawler polls for a slot —
 * because the room frees as soon as other work settles.
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { SpawnerBusyError } from './helpers/session_client';

/** How long a lane waits before asking again when the refusal names no
 * retry hint: the organization's own budget frees on a release edge, so a
 * retry soon after is cheap. */
const DEFAULT_CAPACITY_RETRY_MS = 15_000;

export interface CapacityRefusal {
  /** Whose room ran out: the organization's budget, or the shared host. */
  scope: 'organization' | 'host';
  retryAfterMs: number;
}

/** The capacity refusal `err` is, or null when it is anything else. */
export function sandboxCapacityRefusal(err: unknown): CapacityRefusal | null {
  if (err instanceof SpawnerBusyError) {
    return {
      scope: 'host',
      retryAfterMs: err.retryAfterMs ?? DEFAULT_CAPACITY_RETRY_MS,
    };
  }
  if (isQuotaExceeded(err)) {
    return { scope: 'organization', retryAfterMs: DEFAULT_CAPACITY_RETRY_MS };
  }
  return null;
}

/** The `QUOTA_EXCEEDED` shape thrown by the slot reserve and the cap-checked
 * resume: an AppError whose data names the code, the sessions domain's
 * `SandboxQuotaError` (its own `code`), or either wrapped by a sub-mutation
 * into a plain Error whose message carries the payload. */
function isQuotaExceeded(err: unknown): boolean {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    return (
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      data.code === 'QUOTA_EXCEEDED'
    );
  }
  if (err instanceof Error && 'code' in err && err.code === 'QUOTA_EXCEEDED') {
    return true;
  }
  return err instanceof Error && err.message.includes('QUOTA_EXCEEDED');
}
