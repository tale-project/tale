'use client';

/**
 * The thread-row actions: rename, pin, archive, and the read watermark.
 *
 * Like `thread-sharing`, these go through the live Convex client
 * (`useConvex`) rather than the app's `useConvexMutation` wrapper: the wrapper
 * needs the query-client context, which a chat component rendered outside the
 * provider tree does not have, and `useConvex()` returns `undefined` there
 * instead of throwing. Failures resolve to `false` — never a rejection — so a
 * caller shows its failure toast without wrapping every call site.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';

export interface ThreadActions {
  /** False when there is no Convex client to talk to — hide the controls. */
  readonly available: boolean;
  /** Rename the thread. False when refused (foreign thread, empty name). */
  readonly rename: (threadId: string, title: string) => Promise<boolean>;
  readonly setPinned: (threadId: string, pinned: boolean) => Promise<boolean>;
  readonly setArchived: (
    threadId: string,
    archived: boolean,
  ) => Promise<boolean>;
  /** Stamp the owner's read watermark. Fire-and-forget: a failure only means
   * the unread dot lingers, so it logs instead of surfacing. */
  readonly markRead: (threadId: string) => void;
}

export function useThreadActions(organizationId: string): ThreadActions {
  const convex = useConvex();

  const rename = useCallback(
    async (threadId: string, title: string): Promise<boolean> => {
      if (!convex) return false;
      try {
        return await convex.mutation(api.chat.threads.renameThread, {
          organizationId,
          threadId,
          title,
        });
      } catch (error) {
        console.error('[chat] renaming the thread failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  const setPinned = useCallback(
    async (threadId: string, pinned: boolean): Promise<boolean> => {
      if (!convex) return false;
      try {
        return await convex.mutation(api.chat.threads.setThreadPinned, {
          organizationId,
          threadId,
          pinned,
        });
      } catch (error) {
        console.error('[chat] pinning the thread failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  const setArchived = useCallback(
    async (threadId: string, archived: boolean): Promise<boolean> => {
      if (!convex) return false;
      try {
        return await convex.mutation(api.chat.threads.setThreadArchived, {
          organizationId,
          threadId,
          archived,
        });
      } catch (error) {
        console.error('[chat] archiving the thread failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  const markRead = useCallback(
    (threadId: string): void => {
      if (!convex) return;
      convex
        .mutation(api.chat.threads.markThreadRead, {
          organizationId,
          threadId,
        })
        .catch((error: unknown) => {
          console.warn('[chat] marking the thread read failed', error);
        });
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({
      available: convex !== undefined,
      rename,
      setPinned,
      setArchived,
      markRead,
    }),
    [convex, rename, setPinned, setArchived, markRead],
  );
}
