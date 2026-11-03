import type { Proxy, SessionRef } from '@/lib/api/schemas';

/**
 * What the session column of a proxy says:
 * - `session`: a session has it (or is being given it);
 * - `failed`: nobody has it, and it does not work, so no session is given it;
 * - `same-ip`: nobody has it, and another session has the exit IP it would
 *   have, so no session is given it either;
 * - `free`: a session can be given it (also while it is unchecked or being
 *   checked: it is not known to be bad).
 *
 * One answer for the cell and for the search, so what a person can type is
 * what the cell says.
 */
export type SessionCell =
  | { kind: 'session'; session: SessionRef }
  | { kind: 'failed' }
  | { kind: 'same-ip'; other: SessionRef }
  | { kind: 'free' };

export function sessionCellOf(
  proxy: Pick<Proxy, 'session' | 'sameIpAs' | 'check'>,
): SessionCell {
  if (proxy.session !== null)
    return { kind: 'session', session: proxy.session };
  if (proxy.check.ok === false) return { kind: 'failed' };
  if (proxy.sameIpAs !== null)
    return { kind: 'same-ip', other: proxy.sameIpAs };
  return { kind: 'free' };
}
