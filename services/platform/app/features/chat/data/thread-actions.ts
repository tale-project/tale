'use client';

/**
 * The thread-row actions: rename, pin, archive, and the read watermark —
 * served by the 0.5 backend. Failures resolve to `false` — never a
 * rejection — so a caller shows its failure toast without wrapping every
 * call site. Each successful write nudges the thread-family reads through
 * the same query client the seam's HTTP lane uses, so the writer's own tab
 * is instantly true (other tabs ride the org hint stream).
 */

import { useCallback, useMemo } from 'react';

import {
  invalidateChatThreads,
  markChatThreadRead,
  renameChatThread,
  setChatThreadArchived,
  setChatThreadPinned,
  trashChatThread,
} from '@/app/lib/backend/chat';

import { useChatQueryClient } from './chat-backend';

export interface ThreadActions {
  /** Kept for the control-hiding contract; the HTTP lane is always there. */
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
  const queryClient = useChatQueryClient();

  const settle = useCallback(
    (ok: boolean): boolean => {
      if (ok) invalidateChatThreads(queryClient, organizationId);
      return ok;
    },
    [queryClient, organizationId],
  );

  const rename = useCallback(
    async (threadId: string, title: string): Promise<boolean> => {
      try {
        return settle(await renameChatThread(organizationId, threadId, title));
      } catch (error) {
        console.error('[chat] renaming the thread failed', error);
        return false;
      }
    },
    [organizationId, settle],
  );

  const setPinned = useCallback(
    async (threadId: string, pinned: boolean): Promise<boolean> => {
      try {
        return settle(
          await setChatThreadPinned(organizationId, threadId, pinned),
        );
      } catch (error) {
        console.error('[chat] pinning the thread failed', error);
        return false;
      }
    },
    [organizationId, settle],
  );

  const setArchived = useCallback(
    async (threadId: string, archived: boolean): Promise<boolean> => {
      try {
        return settle(
          await setChatThreadArchived(organizationId, threadId, archived),
        );
      } catch (error) {
        console.error('[chat] archiving the thread failed', error);
        return false;
      }
    },
    [organizationId, settle],
  );

  const markRead = useCallback(
    (threadId: string, read = true): void => {
      markChatThreadRead(organizationId, threadId, read).then(
        (ok) => settle(ok),
        (error: unknown) => {
          console.warn('[chat] moving the read watermark failed', error);
        },
      );
    },
    [organizationId, settle],
  );

  const trash = useCallback(
    async (threadId: string): Promise<boolean> => {
      try {
        return settle(await trashChatThread(organizationId, threadId));
      } catch (error) {
        console.error('[chat] trashing the thread failed', error);
        return false;
      }
    },
    [organizationId, settle],
  );

  return useMemo(
    () => ({
      available: true,
      rename,
      setPinned,
      setArchived,
      markRead,
      trash,
    }),
    [rename, setPinned, setArchived, markRead, trash],
  );
}
