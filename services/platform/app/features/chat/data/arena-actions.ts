'use client';

/**
 * The arena writes: pair creation, the fanned-out send, and the settle.
 *
 * Same seam shape as `thread-actions` on the 0.5 backend: plain fetch
 * functions (`app/lib/backend/chat.ts`), and failures resolve refusal
 * shapes — never a rejection — so callers toast without try/catch at
 * every site.
 */

import { useCallback, useMemo } from 'react';

import {
  createChatThread,
  ensureArenaPairRequest,
  invalidateChatMessages,
  settleArenaPairRequest,
  startArenaTurnRequest,
} from '@/app/lib/backend/chat';
import type { ReasoningEffort } from '@/lib/chat/effort';
import type { ArenaVerdict } from '@/lib/shared/arena';

import { isBudgetRefusalCode } from '../utils/classify-refusal';
import { invalidateBudgetStanding, useChatQueryClient } from './chat-backend';

interface SideResult {
  readonly status: 'completed' | 'refused';
  readonly reason?: string;
  /** The side's refusal is on its thread's record — see `ChatTurnOutcome`. */
  readonly persisted?: boolean;
  /** The refusal's stable code when the server names one — see
   * `ChatTurnOutcome.code`. */
  readonly code?: string;
}

export interface ArenaActions {
  readonly available: boolean;
  /** A bare conversation to arena from the index — created empty, then
   * paired; the first send fans into both columns. */
  readonly createThread: (
    projectId?: string,
    reasoningEffort?: ReasoningEffort,
  ) => Promise<string | null>;
  /** Create (or return) the pair. Resolves the refusal reason on refusal. */
  readonly ensurePair: (
    threadId: string,
  ) => Promise<{ threadIdB: string } | { refused: string }>;
  /** Fan one prompt into both columns. */
  readonly startTurn: (args: {
    threadId: string;
    /** The other column — both transcripts are read afresh once the
     * fan-out settles, so a side refused before it streamed still shows
     * its refusal without a reload. */
    partnerThreadId?: string;
    userText: string;
    modelIdA: string;
    modelIdB: string;
    providerSlugA?: string;
    providerSlugB?: string;
    /** One effort for both columns — the pair compares models, not knobs. */
    reasoningEffort?: ReasoningEffort;
    locale?: string;
  }) => Promise<{ a: SideResult; b: SideResult }>;
  /** Settle the pair — verdict picks the surviving thread; none = exit. */
  readonly settle: (
    threadId: string,
    verdict?: ArenaVerdict,
  ) => Promise<{ continueThreadId: string } | { refused: string }>;
}

export function useArenaActions(organizationId: string): ArenaActions {
  const queryClient = useChatQueryClient();
  const createThread = useCallback(
    async (
      projectId?: string,
      reasoningEffort?: ReasoningEffort,
    ): Promise<string | null> => {
      try {
        return await createChatThread({
          organizationId,
          kind: 'direct',
          ...(projectId !== undefined ? { projectId } : {}),
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        });
      } catch (error) {
        console.error('[arena] could not create the conversation', error);
        return null;
      }
    },
    [organizationId],
  );

  const ensurePair = useCallback(
    async (
      threadId: string,
    ): Promise<{ threadIdB: string } | { refused: string }> => {
      try {
        return await ensureArenaPairRequest(organizationId, threadId);
      } catch (error) {
        console.error('[arena] pairing failed', error);
        return { refused: 'error' };
      }
    },
    [organizationId],
  );

  const startTurn = useCallback(
    async (args: {
      threadId: string;
      partnerThreadId?: string;
      userText: string;
      modelIdA: string;
      modelIdB: string;
      providerSlugA?: string;
      providerSlugB?: string;
      reasoningEffort?: ReasoningEffort;
      locale?: string;
    }): Promise<{ a: SideResult; b: SideResult }> => {
      const { threadId, partnerThreadId, ...body } = args;
      try {
        const sides = await startArenaTurnRequest(
          organizationId,
          threadId,
          body,
        );
        // A reached cap refuses the pair: the banner learns it now.
        if ([sides.a, sides.b].some((side) => isBudgetRefusalCode(side.code))) {
          invalidateBudgetStanding(queryClient, organizationId);
        }
        return sides;
      } catch (error) {
        console.error('[arena] the fanned turn failed', error);
        const failed: SideResult = { status: 'refused' };
        return { a: failed, b: failed };
      } finally {
        // A column streams through its SSE lane, but a side refused before
        // its generation row existed never fires it: read both transcripts
        // afresh so the losing column shows its error row (or stays
        // honestly empty) without a reload — what `chatSend.start` does for
        // a single thread.
        invalidateChatMessages(queryClient, organizationId, threadId);
        if (partnerThreadId !== undefined) {
          invalidateChatMessages(queryClient, organizationId, partnerThreadId);
        }
      }
    },
    [organizationId, queryClient],
  );

  const settle = useCallback(
    async (
      threadId: string,
      verdict?: ArenaVerdict,
    ): Promise<{ continueThreadId: string } | { refused: string }> => {
      try {
        return await settleArenaPairRequest(organizationId, threadId, verdict);
      } catch (error) {
        console.error('[arena] settling failed', error);
        return { refused: 'error' };
      }
    },
    [organizationId],
  );

  return useMemo(
    () => ({
      available: true,
      createThread,
      ensurePair,
      startTurn,
      settle,
    }),
    [createThread, ensurePair, startTurn, settle],
  );
}
