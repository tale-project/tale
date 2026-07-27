'use client';

/**
 * The branch writes: fork-for-edit, fork-for-regenerate, the regenerate turn
 * itself, the sibling selection, and the visible fork.
 *
 * Same seam shape as `thread-actions`: straight through the live Convex
 * client so a render outside the provider tree degrades to
 * `available: false`, and failures resolve `null`/`false` — never a
 * rejection — so callers toast without try/catch at every site.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';

export interface BranchActions {
  readonly available: boolean;
  /** Fork the thread BEFORE the edited user message; resolves the branch id. */
  readonly branchForEdit: (
    threadId: string,
    editedMessageId: string,
  ) => Promise<string | null>;
  /** Fork the thread THROUGH the prompt the assistant reply answered. */
  readonly branchForRegenerate: (
    threadId: string,
    assistantMessageId: string,
  ) => Promise<string | null>;
  /** Re-run the branch's trailing prompt. Resolves the refusal reason, or
   * null on success (mirrors the send handle's outcome shape). */
  readonly regenerate: (
    threadId: string,
    modelId: string,
    providerSlug?: string,
  ) => Promise<{ refused: boolean; reason?: string }>;
  /** Persist which sibling a fork point shows. Fire-and-forget. */
  readonly select: (
    rootThreadId: string,
    forkKey: string,
    selectedThreadId: string,
  ) => void;
  /** A visible fork of the conversation up to a message. */
  readonly fork: (
    threadId: string,
    fromMessageId: string,
    title: string,
  ) => Promise<string | null>;
}

export function useBranchActions(organizationId: string): BranchActions {
  const convex = useConvex();

  const branchForEdit = useCallback(
    async (
      threadId: string,
      editedMessageId: string,
    ): Promise<string | null> => {
      if (!convex) return null;
      try {
        return await convex.mutation(api.chat.branches.branchForEdit, {
          organizationId,
          threadId,
          editedMessageId,
        });
      } catch (error) {
        console.error('[chat] branching for the edit failed', error);
        return null;
      }
    },
    [convex, organizationId],
  );

  const branchForRegenerate = useCallback(
    async (
      threadId: string,
      assistantMessageId: string,
    ): Promise<string | null> => {
      if (!convex) return null;
      try {
        return await convex.mutation(api.chat.branches.branchForRegenerate, {
          organizationId,
          threadId,
          assistantMessageId,
        });
      } catch (error) {
        console.error('[chat] branching for the regenerate failed', error);
        return null;
      }
    },
    [convex, organizationId],
  );

  const regenerate = useCallback(
    async (
      threadId: string,
      modelId: string,
      providerSlug?: string,
    ): Promise<{ refused: boolean; reason?: string }> => {
      if (!convex) return { refused: true };
      try {
        const outcome = await convex.action(
          api.chat.turn_action.regenerateTurn,
          {
            organizationId,
            threadId,
            modelId,
            ...(providerSlug !== undefined ? { providerSlug } : {}),
          },
        );
        return outcome.status === 'refused'
          ? {
              refused: true,
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            }
          : { refused: false };
      } catch (error) {
        console.error('[chat] the regenerate turn failed', error);
        return { refused: true };
      }
    },
    [convex, organizationId],
  );

  const select = useCallback(
    (rootThreadId: string, forkKey: string, selectedThreadId: string): void => {
      if (!convex) return;
      convex
        .mutation(api.chat.branches.setBranchSelection, {
          organizationId,
          rootThreadId,
          forkKey,
          selectedThreadId,
        })
        .catch((error: unknown) => {
          // A lost write costs one re-flip after reload, never a broken view.
          console.warn('[chat] saving the branch selection failed', error);
        });
    },
    [convex, organizationId],
  );

  const fork = useCallback(
    async (
      threadId: string,
      fromMessageId: string,
      title: string,
    ): Promise<string | null> => {
      if (!convex) return null;
      try {
        return await convex.mutation(api.chat.threads.branchThread, {
          organizationId,
          threadId,
          fromMessageId,
          title,
        });
      } catch (error) {
        console.error('[chat] forking the thread failed', error);
        return null;
      }
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({
      available: convex !== undefined,
      branchForEdit,
      branchForRegenerate,
      regenerate,
      select,
      fork,
    }),
    [convex, branchForEdit, branchForRegenerate, regenerate, select, fork],
  );
}
