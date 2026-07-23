'use client';

/**
 * Share and unshare mutations for chat threads.
 *
 * Like the reads in `chat-backend`, these go through the live Convex client
 * (`useConvex`) rather than the app's `useConvexMutation` wrapper: the wrapper
 * needs the query-client context, which a chat component rendered outside the
 * provider tree does not have, and `useConvex()` returns `undefined` there
 * instead of throwing. Failures resolve to `null`/`false` — never a rejection
 * — so a caller shows its failure toast without wrapping every call site.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';

export interface ThreadSharing {
  /** False when there is no Convex client to talk to — hide the controls. */
  readonly available: boolean;
  /**
   * Publish (or re-publish) the thread as an org-internal snapshot link.
   * Resolves the token the share URL is built from, or `null` when the
   * backend refused (not the caller's thread) or the call failed.
   */
  readonly share: (threadId: string) => Promise<string | null>;
  /** Take the share link down. Resolves false when the call failed. */
  readonly unshare: (threadId: string) => Promise<boolean>;
}

export function useThreadSharing(organizationId: string): ThreadSharing {
  const convex = useConvex();

  const share = useCallback(
    async (threadId: string): Promise<string | null> => {
      if (!convex) return null;
      try {
        const result = await convex.mutation(api.chat.threads.shareThread, {
          organizationId,
          threadId,
        });
        return result?.shareToken ?? null;
      } catch (error) {
        console.error('[chat] sharing the thread failed', error);
        return null;
      }
    },
    [convex, organizationId],
  );

  const unshare = useCallback(
    async (threadId: string): Promise<boolean> => {
      if (!convex) return false;
      try {
        await convex.mutation(api.chat.threads.unshareThread, {
          organizationId,
          threadId,
        });
        return true;
      } catch (error) {
        console.error('[chat] unsharing the thread failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({ available: convex !== undefined, share, unshare }),
    [convex, share, unshare],
  );
}
