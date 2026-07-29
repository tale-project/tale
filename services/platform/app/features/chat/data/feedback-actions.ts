'use client';

/**
 * The message-rating writes: submit (upsert) and remove.
 *
 * Same shape as `thread-actions`: straight through the live Convex client so
 * a chat component outside the provider tree degrades to `available: false`,
 * and failures resolve `false` — never a rejection — so the toolbar shows its
 * failure state without wrapping every call site.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';

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
  const convex = useConvex();

  const submit = useCallback(
    async (
      threadId: string,
      messageId: string,
      rating: FeedbackRating,
      comment?: string,
    ): Promise<boolean> => {
      if (!convex) return false;
      try {
        await convex.mutation(api.feedback.mutations.submitFeedback, {
          organizationId,
          threadId,
          messageId,
          rating,
          ...(comment !== undefined && comment.length > 0 ? { comment } : {}),
        });
        return true;
      } catch (error) {
        console.error('[chat] submitting feedback failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  const remove = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!convex) return false;
      try {
        await convex.mutation(api.feedback.mutations.deleteFeedback, {
          organizationId,
          messageId,
        });
        return true;
      } catch (error) {
        console.error('[chat] removing feedback failed', error);
        return false;
      }
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({ available: convex !== undefined, submit, remove }),
    [convex, submit, remove],
  );
}
