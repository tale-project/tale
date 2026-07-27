'use client';

/**
 * The arena writes: pair creation, the fanned-out send, and the settle.
 *
 * Same seam shape as `thread-actions`: straight through the live Convex
 * client so a render outside the provider tree degrades to
 * `available: false`, and failures resolve refusal shapes — never a
 * rejection — so callers toast without try/catch at every site.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';
import type { ArenaVerdict } from '@/lib/shared/arena';

interface SideResult {
  readonly status: 'completed' | 'refused';
  readonly reason?: string;
}

export interface ArenaActions {
  readonly available: boolean;
  /** A bare conversation to arena from the index — created empty, then
   * paired; the first send fans into both columns. */
  readonly createThread: (projectId?: string) => Promise<string | null>;
  /** Create (or return) the pair. Resolves the refusal reason on refusal. */
  readonly ensurePair: (
    threadId: string,
  ) => Promise<{ threadIdB: string } | { refused: string }>;
  /** Fan one prompt into both columns. */
  readonly startTurn: (args: {
    threadId: string;
    userText: string;
    modelIdA: string;
    modelIdB: string;
    providerSlugA?: string;
    providerSlugB?: string;
    locale?: string;
  }) => Promise<{ a: SideResult; b: SideResult }>;
  /** Settle the pair — verdict picks the surviving thread; none = exit. */
  readonly settle: (
    threadId: string,
    verdict?: ArenaVerdict,
  ) => Promise<{ continueThreadId: string } | { refused: string }>;
}

const UNAVAILABLE: SideResult = {
  status: 'refused',
  reason: 'backend unavailable',
};

export function useArenaActions(organizationId: string): ArenaActions {
  const convex = useConvex();

  const createThread = useCallback(
    async (projectId?: string): Promise<string | null> => {
      if (!convex) return null;
      try {
        return await convex.mutation(api.chat.threads.createThread, {
          organizationId,
          kind: 'direct',
          ...(projectId !== undefined ? { projectId } : {}),
        });
      } catch (error) {
        console.error('[arena] could not create the conversation', error);
        return null;
      }
    },
    [convex, organizationId],
  );

  const ensurePair = useCallback(
    async (
      threadId: string,
    ): Promise<{ threadIdB: string } | { refused: string }> => {
      if (!convex) return { refused: 'unavailable' };
      try {
        return await convex.mutation(api.chat.arena.ensureArenaPair, {
          organizationId,
          threadId,
        });
      } catch (error) {
        console.error('[arena] pairing failed', error);
        return { refused: 'error' };
      }
    },
    [convex, organizationId],
  );

  const startTurn = useCallback(
    async (args: {
      threadId: string;
      userText: string;
      modelIdA: string;
      modelIdB: string;
      providerSlugA?: string;
      providerSlugB?: string;
      locale?: string;
    }): Promise<{ a: SideResult; b: SideResult }> => {
      if (!convex) return { a: UNAVAILABLE, b: UNAVAILABLE };
      try {
        return await convex.action(api.chat.arena_action.startArenaTurn, {
          organizationId,
          ...args,
        });
      } catch (error) {
        console.error('[arena] the fanned turn failed', error);
        const failed: SideResult = { status: 'refused' };
        return { a: failed, b: failed };
      }
    },
    [convex, organizationId],
  );

  const settle = useCallback(
    async (
      threadId: string,
      verdict?: ArenaVerdict,
    ): Promise<{ continueThreadId: string } | { refused: string }> => {
      if (!convex) return { refused: 'unavailable' };
      try {
        return await convex.mutation(api.chat.arena.settleArenaPair, {
          organizationId,
          threadId,
          ...(verdict !== undefined ? { verdict } : {}),
        });
      } catch (error) {
        console.error('[arena] settling failed', error);
        return { refused: 'error' };
      }
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({
      available: convex !== undefined,
      createThread,
      ensurePair,
      startTurn,
      settle,
    }),
    [convex, createThread, ensurePair, startTurn, settle],
  );
}
