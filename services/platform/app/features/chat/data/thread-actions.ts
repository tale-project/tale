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
  /** Move the owner's read watermark (forward, or back to unread with
   * `read: false`). Fire-and-forget: a failure only means the unread dot
   * lingers, so it logs instead of surfacing. */
  readonly markRead: (threadId: string, read?: boolean) => void;
  /** Move the thread to Trash (restorable for the org's grace period).
   * False when refused — foreign thread, a running turn, or a legal hold. */
  readonly trash: (threadId: string) => Promise<boolean>;
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
    (threadId: string, read = true): void => {
      if (!convex) return;
      convex
        .mutation(api.chat.threads.markThreadRead, {
          organizationId,
          threadId,
          ...(read ? {} : { read: false }),
        })
        .catch((error: unknown) => {
          console.warn('[chat] marking the thread read failed', error);
        });
    },
    [convex, organizationId],
  );

  const trash = useCallback(
    async (threadId: string): Promise<boolean> => {
      if (!convex) return false;
      try {
        return await convex.mutation(api.chat.thread_lifecycle.trashThread, {
          organizationId,
          threadId,
        });
      } catch (error) {
        // A legal hold surfaces as a coded refusal; either way the caller
        // shows its failure toast.
        console.error('[chat] deleting the thread failed', error);
        return false;
      }
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
      trash,
    }),
    [convex, rename, setPinned, setArchived, markRead, trash],
  );
}
