'use client';

/**
 * Chat sharing — served by the 0.5 backend: the thread's sharing status,
 * the share and unshare mutations, and the link a share is read at.
 * Mutation failures resolve to `null`/`false` — never a rejection — so a
 * caller shows its failure toast without wrapping every call site.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  invalidateChatThreads,
  shareChatThread,
  threadShareStatusQuery,
  unshareChatThread,
} from '@/app/lib/backend/chat';
import { getEnv } from '@/lib/env';

import { useChatQueryClient } from './chat-backend';

/**
 * Whether a thread is shared, as far as this tab can tell. Only an answer
 * from the latest read is `known`; a read that failed — even one that failed
 * over an older answer — is `unknown`, because a privacy choice made against
 * a guess can leave a live link standing while the screen says it is gone.
 */
export type ThreadShareStatus =
  | { readonly state: 'loading' }
  | {
      readonly state: 'unknown';
      /** Drop the unconfirmed answer and read the status again. */
      readonly retry: () => void;
    }
  | {
      readonly state: 'known';
      readonly isShared: boolean;
      /** Kept across an unshare, so re-sharing restores the same link. */
      readonly shareToken: string | null;
      readonly isShareable: boolean;
    };

export function useThreadShareStatus(
  organizationId: string,
  threadId: string,
): ThreadShareStatus {
  const queryClient = useChatQueryClient();
  const status = useQuery(
    threadShareStatusQuery(organizationId, threadId),
    queryClient,
  );

  const retry = useCallback(() => {
    void queryClient.resetQueries({
      queryKey: threadShareStatusQuery(organizationId, threadId).queryKey,
      exact: true,
    });
  }, [queryClient, organizationId, threadId]);

  return useMemo(() => {
    if (status.isSuccess) {
      // `null` is the 404 — no such thread of the caller's: nothing shared.
      const share = status.data;
      return {
        state: 'known',
        isShared: share?.isShared === true,
        shareToken: share?.shareToken ?? null,
        isShareable: share?.isShareable ?? true,
      };
    }
    if (status.isError) return { state: 'unknown', retry };
    return { state: 'loading' };
  }, [status.isSuccess, status.isError, status.data, retry]);
}

/**
 * The address a share is read at: the deployment's own origin and base path
 * (`${SITE_URL}${BASE_PATH}`, the convention every absolute link of the app
 * follows) in front of the shared-chat route.
 */
export function threadShareUrl(
  organizationId: string,
  shareToken: string,
): string {
  const basePath = getEnv('BASE_PATH').replace(/^\/*/, '/').replace(/\/+$/, '');
  const path = `${basePath}/dashboard/${encodeURIComponent(organizationId)}/chat/shared/${encodeURIComponent(shareToken)}`;
  return new URL(path, getEnv('SITE_URL')).href;
}

/** A share or unshare that succeeded IS the new status: record it at once,
 * so an open dialog never shows the old one while the refetch is on its way.
 * A status never read stays unread. */
function recordShareStatus(
  queryClient: QueryClient,
  organizationId: string,
  threadId: string,
  next: { isShared: boolean; shareToken?: string },
): void {
  queryClient.setQueryData(
    threadShareStatusQuery(organizationId, threadId).queryKey,
    (current) =>
      current == null
        ? current
        : {
            ...current,
            isShared: next.isShared,
            shareToken: next.shareToken ?? current.shareToken,
          },
  );
}

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
        recordShareStatus(queryClient, organizationId, threadId, {
          isShared: true,
          shareToken: result.shareToken,
        });
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
        if (ok) {
          recordShareStatus(queryClient, organizationId, threadId, {
            isShared: false,
          });
          invalidateChatThreads(queryClient, organizationId);
        }
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
