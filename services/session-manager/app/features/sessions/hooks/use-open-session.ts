import type { Session } from '@/lib/api/schemas';

import { useSession } from './use-session';

/** No session has this id (they start at 1): what the read is for while it has nothing to read. */
const NO_SESSION = 0;

/**
 * The open session, when the rows the list has loaded do not hold it (it is
 * older than the newest ones the list shows, and its page was opened from a
 * link): the session the page reads anyway, so that the list can show it as a
 * row and not leave the open page unmarked. The same read as the page's, which
 * the two share. `null` while the rows hold it, none is open, or it does not
 * exist.
 */
export function useOpenSessionOutsideRows(
  openId: number | null,
  rows: readonly Session[],
): Session | null {
  const held = openId !== null && rows.some((row) => row.id === openId);
  const read = useSession(openId ?? NO_SESSION, {
    enabled: openId !== null && !held,
  });
  return openId !== null && !held ? (read.data ?? null) : null;
}

/** The rows with the open session among them, where its id puts it (newest first). */
export function withOpenSession(
  rows: readonly Session[],
  open: Session | null,
): readonly Session[] {
  if (open === null) return rows;
  const at = rows.findIndex((row) => row.id < open.id);
  return at === -1
    ? [...rows, open]
    : [...rows.slice(0, at), open, ...rows.slice(at)];
}
