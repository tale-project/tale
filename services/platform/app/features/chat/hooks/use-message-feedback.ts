import { useCallback } from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

interface UseMessageFeedbackParams {
  messageId: string;
  threadId: string;
  organizationId: string;
}

export function useMessageFeedback({
  messageId,
  threadId,
  organizationId,
}: UseMessageFeedbackParams) {
  const { data: feedback, isLoading } = useConvexQuery(
    api.feedback.queries.getMessageFeedback,
    { messageId },
  );

  const { mutateAsync: submitFeedbackMutation } = useConvexMutation(
    api.feedback.mutations.submitFeedback,
  );

  const { mutateAsync: deleteFeedbackMutation } = useConvexMutation(
    api.feedback.mutations.deleteFeedback,
  );

  const submitFeedback = useCallback(
    async (
      rating: 'positive' | 'negative',
      comment?: string,
      metadata?: {
        arenaVerdict?: string;
        modelA?: string;
        modelB?: string;
      },
    ) => {
      await submitFeedbackMutation({
        organizationId,
        threadId,
        messageId,
        rating,
        comment,
        metadata,
      });
    },
    [submitFeedbackMutation, organizationId, threadId, messageId],
  );

  const removeFeedback = useCallback(async () => {
    await deleteFeedbackMutation({
      organizationId,
      messageId,
    });
  }, [deleteFeedbackMutation, organizationId, messageId]);

  return {
    feedback,
    isLoading,
    submitFeedback,
    removeFeedback,
  };
}
