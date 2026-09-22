'use client';

/**
 * The branch writes: fork-for-edit, fork-for-regenerate, the regenerate turn
 * itself, the sibling selection, and the visible fork.
 *
 * Same seam shape as `thread-actions`: straight through the live Convex
 * client so a render outside the provider tree degrades to
 * `available: false`, and failures resolve a status — never a rejection —
 * so callers toast without try/catch at every site.
 */

import { useCallback, useMemo } from 'react';

import { BackendApiError } from '@/app/lib/backend/api-client';
import {
  regenerateChatTurn,
  branchChatThread,
  branchChatThreadForEdit,
  branchChatThreadForRegenerate,
  invalidateChatThreads,
  setChatBranchSelection,
  trashChatThread,
} from '@/app/lib/backend/chat';
import type { ReasoningEffort } from '@/lib/chat/effort';

import { isBudgetRefusalCode } from '../utils/classify-refusal';
import { invalidateBudgetStanding, useChatQueryClient } from './chat-backend';

/**
 * How a fork resolved. A fork is the first half of a turn, so the door
 * measures the sender's budget before forking: a reached cap answers 429
 * `BUDGET_EXCEEDED` with nothing created, and the surface names it exactly
 * like a refused send. Anything else that fails is `failed`.
 */
export type BranchForkResult =
  | { readonly status: 'created'; readonly id: string }
  | {
      readonly status: 'refused';
      readonly reason: string;
      readonly code?: string;
    }
  | { readonly status: 'failed' };

/** The outcome of the regenerate turn — the send handle's outcome shape. */
export interface RegenerateOutcome {
  readonly refused: boolean;
  readonly reason?: string;
  /** The refusal's stable code when the server names one. */
  readonly code?: string;
  /** True when the refusal is already on the branch's record (a blocked
   * reply landed), false when the door wrote nothing; ABSENT when the
   * request itself failed and whether the turn landed is unknown. */
  readonly persisted?: boolean;
}

function forkResultOf(error: unknown): BranchForkResult {
  if (error instanceof BackendApiError && error.status === 429) {
    return {
      status: 'refused',
      reason: error.message,
      ...(error.code !== undefined ? { code: error.code } : {}),
    };
  }
  return { status: 'failed' };
}

export interface BranchActions {
  readonly available: boolean;
  /** Fork the thread BEFORE the edited user message. */
  readonly branchForEdit: (
    threadId: string,
    editedMessageId: string,
  ) => Promise<BranchForkResult>;
  /** Fork the thread THROUGH the prompt the assistant reply answered. */
  readonly branchForRegenerate: (
    threadId: string,
    assistantMessageId: string,
  ) => Promise<BranchForkResult>;
  /** Re-run the branch's trailing prompt. Resolves the refusal, or
   * `refused: false` on success (mirrors the send handle's outcome shape).
   * The model pick mirrors the composer's: a concrete id, or Auto — under
   * Auto every "try again" re-resolves and may legitimately land on a
   * different model. */
  readonly regenerate: (
    threadId: string,
    pick: {
      readonly modelId?: string;
      readonly modelSelection?: 'auto';
      readonly providerSlug?: string;
      readonly reasoningEffort?: ReasoningEffort;
    },
  ) => Promise<RegenerateOutcome>;
  /** Drop a sibling no turn ever landed in — the fork of an edit or
   * regenerate whose send was then refused without writing anything. It
   * goes to Trash (a hidden row never lists there; retention reaps it), so
   * the fork point shows no empty sibling for the view to strand on. Best
   * effort: a failure costs an empty ‹n/m› entry, never the conversation. */
  readonly discard: (threadId: string) => Promise<void>;
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

  // A refused fork wrote nothing; the banner learns a reached cap now.
  const settleForkFailure = useCallback(
    (what: string, error: unknown): BranchForkResult => {
      const result = forkResultOf(error);
      if (result.status === 'refused') {
        if (isBudgetRefusalCode(result.code)) {
          invalidateBudgetStanding(queryClient, organizationId);
        }
        return result;
      }
      console.error(`[chat] branching for the ${what} failed`, error);
      return result;
    },
    [queryClient, organizationId],
  );

  const branchForEdit = useCallback(
    async (
      threadId: string,
      editedMessageId: string,
    ): Promise<BranchForkResult> => {
      try {
        const id = await branchChatThreadForEdit(
          organizationId,
          threadId,
          editedMessageId,
        );
        invalidateChatThreads(queryClient, organizationId);
        return { status: 'created', id };
      } catch (error) {
        return settleForkFailure('edit', error);
      }
    },
    [queryClient, organizationId, settleForkFailure],
  );

  const branchForRegenerate = useCallback(
    async (
      threadId: string,
      assistantMessageId: string,
    ): Promise<BranchForkResult> => {
      try {
        const id = await branchChatThreadForRegenerate(
          organizationId,
          threadId,
          assistantMessageId,
        );
        invalidateChatThreads(queryClient, organizationId);
        return { status: 'created', id };
      } catch (error) {
        return settleForkFailure('regenerate', error);
      }
    },
    [queryClient, organizationId, settleForkFailure],
  );

  const discard = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        await trashChatThread(organizationId, threadId);
        invalidateChatThreads(queryClient, organizationId);
      } catch (error) {
        console.warn('[chat] discarding the empty branch failed', error);
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
    ): Promise<RegenerateOutcome> => {
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
        if (outcome.status !== 'refused') return { refused: false };
        if (isBudgetRefusalCode(outcome.code)) {
          invalidateBudgetStanding(queryClient, organizationId);
        }
        return {
          refused: true,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(outcome.code !== undefined ? { code: outcome.code } : {}),
          persisted: outcome.persisted === true,
        };
      } catch (error) {
        // The request failed, not the turn: whether it landed is unknown,
        // so `persisted` stays absent and the caller keeps the sibling.
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
      discard,
      select,
      fork,
    }),
    [branchForEdit, branchForRegenerate, regenerate, discard, select, fork],
  );
}
