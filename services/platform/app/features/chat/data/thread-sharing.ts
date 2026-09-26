'use client';

/**
 * Share and unshare mutations for chat threads — served by the 0.5
 * backend. Failures resolve to `null`/`false` — never a rejection — so a
 * caller shows its failure toast without wrapping every call site.
 */

import { useCallback, useMemo } from 'react';

import {
  invalidateChatThreads,
  shareChatThread,
  unshareChatThread,
} from '@/app/lib/backend/chat';

import { useChatQueryClient } from './chat-backend';

export interface ThreadSharing {
  /** Kept for the control-hiding contract; the HTTP lane is always there. */
  readonly available: boolean;
  /**
   * Publish (or re-publish) the thread as an org-internal snapshot link.
   * `threadId` is the lineage root the link names; `leafThreadId` is the
   * sibling on screen, which the snapshot is frozen to — re-publishing
   * re-freezes it. Resolves the token the share URL is built from, or
   * `null` when the backend refused (not the caller's thread, a leaf
   * outside the lineage) or the call failed.
   */
  readonly share: (
    threadId: string,
    leafThreadId?: string,
  ) => Promise<string | null>;
  /** Take the share link down. Resolves false when the call failed. */
  readonly unshare: (threadId: string) => Promise<boolean>;
}

export function useThreadSharing(organizationId: string): ThreadSharing {
  const queryClient = useChatQueryClient();

  const share = useCallback(
    async (threadId: string, leafThreadId?: string): Promise<string | null> => {
      try {
        const result = await shareChatThread(
          organizationId,
          threadId,
          leafThreadId,
        );
        invalidateChatThreads(queryClient, organizationId);
        return result.shareToken;
      } catch (error) {
        console.error('[chat] sharing the thread failed', error);
        return null;
      }
    },
    [queryClient, organizationId],
  );

  const unshare = useCallback(
    async (threadId: string): Promise<boolean> => {
      try {
        const ok = await unshareChatThread(organizationId, threadId);
        if (ok) invalidateChatThreads(queryClient, organizationId);
        return ok;
      } catch (error) {
        console.error('[chat] unsharing the thread failed', error);
        return false;
      }
    },
    [queryClient, organizationId],
  );

  return useMemo(() => ({ available: true, share, unshare }), [share, unshare]);
}
