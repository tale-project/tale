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

import { useCallback, useMemo } from 'react';

import {
  regenerateChatTurn,
  branchChatThread,
  branchChatThreadForEdit,
  branchChatThreadForRegenerate,
  invalidateChatThreads,
  setChatBranchSelection,
} from '@/app/lib/backend/chat';
import type { ReasoningEffort } from '@/lib/chat/effort';

import { useChatQueryClient } from './chat-backend';

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
   * null on success (mirrors the send handle's outcome shape). The model
   * pick mirrors the composer's: a concrete id, or Auto — under Auto every
   * "try again" re-resolves and may legitimately land on a different model. */
  readonly regenerate: (
    threadId: string,
    pick: {
      readonly modelId?: string;
      readonly modelSelection?: 'auto';
      readonly providerSlug?: string;
      readonly reasoningEffort?: ReasoningEffort;
    },
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
  const queryClient = useChatQueryClient();

  const branchForEdit = useCallback(
    async (
      threadId: string,
      editedMessageId: string,
    ): Promise<string | null> => {
      try {
        const id = await branchChatThreadForEdit(
          organizationId,
          threadId,
          editedMessageId,
        );
        invalidateChatThreads(queryClient, organizationId);
        return id;
      } catch (error) {
        console.error('[chat] branching for the edit failed', error);
        return null;
      }
    },
    [queryClient, organizationId],
  );

  const branchForRegenerate = useCallback(
    async (
      threadId: string,
      assistantMessageId: string,
    ): Promise<string | null> => {
      try {
        const id = await branchChatThreadForRegenerate(
          organizationId,
          threadId,
          assistantMessageId,
        );
        invalidateChatThreads(queryClient, organizationId);
        return id;
      } catch (error) {
        console.error('[chat] branching for the regenerate failed', error);
        return null;
      }
    },
    [queryClient, organizationId],
  );

  const regenerate = useCallback(
    async (
      threadId: string,
      pick: {
        readonly modelId?: string;
        readonly modelSelection?: 'auto';
        readonly providerSlug?: string;
        readonly reasoningEffort?: ReasoningEffort;
      },
    ): Promise<{ refused: boolean; reason?: string }> => {
      try {
        const outcome = await regenerateChatTurn(organizationId, threadId, {
          ...(pick.modelId !== undefined ? { modelId: pick.modelId } : {}),
          ...(pick.modelSelection !== undefined
            ? { modelSelection: pick.modelSelection }
            : {}),
          ...(pick.providerSlug !== undefined
            ? { providerSlug: pick.providerSlug }
            : {}),
          ...(pick.reasoningEffort !== undefined
            ? { reasoningEffort: pick.reasoningEffort }
            : {}),
        });
        invalidateChatThreads(queryClient, organizationId);
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
    [queryClient, organizationId],
  );

  const select = useCallback(
    (rootThreadId: string, forkKey: string, selectedThreadId: string): void => {
      setChatBranchSelection(
        organizationId,
        rootThreadId,
        forkKey,
        selectedThreadId,
      )
        .then(() => invalidateChatThreads(queryClient, organizationId))
        .catch((error: unknown) => {
          // A lost write costs one re-flip after reload, never a broken view.
          console.warn('[chat] saving the branch selection failed', error);
        });
    },
    [queryClient, organizationId],
  );

  const fork = useCallback(
    async (
      threadId: string,
      fromMessageId: string,
      title: string,
    ): Promise<string | null> => {
      try {
        const id = await branchChatThread(
          organizationId,
          threadId,
          fromMessageId,
          title,
        );
        invalidateChatThreads(queryClient, organizationId);
        return id;
      } catch (error) {
        console.error('[chat] forking the thread failed', error);
        return null;
      }
    },
    [queryClient, organizationId],
  );

  return useMemo(
    () => ({
      available: true,
      branchForEdit,
      branchForRegenerate,
      regenerate,
      select,
      fork,
    }),
    [branchForEdit, branchForRegenerate, regenerate, select, fork],
  );
}
