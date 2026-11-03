import type { Proxy, SessionRef } from '@/lib/api/schemas';

/**
 * What deleting a proxy has to ask first:
 * - `plain`: nobody has it, so it is only removed from the pool;
 * - `in-use`: a stopped session has it and gets another proxy on its next
 *   start, if the person agrees;
 * - `busy`: a running session has it, which stays so until the session stops.
 *
 * The session may be unknown when only the refusal says so and it names none.
 */
export type DeleteStep =
  | { kind: 'plain' }
  | { kind: 'in-use'; session: SessionRef | null }
  | { kind: 'busy'; session: SessionRef | null };

/** A session that is not running, nor on its way up or down. */
function isStopped(session: SessionRef): boolean {
  return session.status === 'stopped' || session.status === 'error';
}

/**
 * The step the table's own data suggests. The backend has the last word (it
 * answers `proxy_in_use` or `proxy_busy` when this is out of date), but asking
 * the right question first spares the person a second dialog.
 */
export function deleteStepOf(proxy: Proxy): DeleteStep {
  if (proxy.session === null) return { kind: 'plain' };
  return {
    kind: isStopped(proxy.session) ? 'in-use' : 'busy',
    session: proxy.session,
  };
}
