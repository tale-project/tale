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
  settleArenaPairRequest,
  startArenaTurnRequest,
} from '@/app/lib/backend/chat';
import type { ReasoningEffort } from '@/lib/chat/effort';
import type { ArenaVerdict } from '@/lib/shared/arena';

interface SideResult {
  readonly status: 'completed' | 'refused';
  readonly reason?: string;
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
      userText: string;
      modelIdA: string;
      modelIdB: string;
      providerSlugA?: string;
      providerSlugB?: string;
      locale?: string;
    }): Promise<{ a: SideResult; b: SideResult }> => {
      try {
        const { threadId, ...body } = args;
        return await startArenaTurnRequest(organizationId, threadId, body);
      } catch (error) {
        console.error('[arena] the fanned turn failed', error);
        const failed: SideResult = { status: 'refused' };
        return { a: failed, b: failed };
      }
    },
    [organizationId],
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
