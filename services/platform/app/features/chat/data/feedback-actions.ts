'use client';

/**
 * The message-rating writes: submit (upsert) and remove.
 *
 * Same shape as `thread-actions`: straight through the live Convex client so
 * a chat component outside the provider tree degrades to `available: false`,
 * and failures resolve `false` — never a rejection — so the toolbar shows its
 * failure state without wrapping every call site.
 */

import { useCallback, useMemo } from 'react';

import {
  invalidateThreadFeedback,
  removeMessageFeedbackRequest,
  submitMessageFeedbackRequest,
} from '@/app/lib/backend/chat';

import { useChatQueryClient } from './chat-backend';

export type FeedbackRating = 'positive' | 'negative';

export interface FeedbackActions {
  readonly available: boolean;
  readonly submit: (
    threadId: string,
    messageId: string,
    rating: FeedbackRating,
    comment?: string,
  ) => Promise<boolean>;
  readonly remove: (messageId: string) => Promise<boolean>;
}

export function useFeedbackActions(organizationId: string): FeedbackActions {
  const queryClient = useChatQueryClient();

  const submit = useCallback(
    async (
      threadId: string,
      messageId: string,
      rating: FeedbackRating,
      comment?: string,
    ): Promise<boolean> => {
      try {
        await submitMessageFeedbackRequest(organizationId, {
          threadId,
          messageId,
          rating,
          ...(comment !== undefined && comment.length > 0 ? { comment } : {}),
        });
        invalidateThreadFeedback(queryClient, organizationId, threadId);
        return true;
      } catch (error) {
        console.error('[chat] submitting feedback failed', error);
        return false;
      }
    },
    [queryClient, organizationId],
  );

  const remove = useCallback(
    async (messageId: string): Promise<boolean> => {
      try {
        await removeMessageFeedbackRequest(organizationId, messageId);
        void queryClient.invalidateQueries({
          queryKey: ['backend', organizationId, 'chat_feedback'],
        });
        return true;
      } catch (error) {
        console.error('[chat] removing feedback failed', error);
        return false;
      }
    },
    [queryClient, organizationId],
  );

  return useMemo(() => ({ available: true, submit, remove }), [submit, remove]);
}
