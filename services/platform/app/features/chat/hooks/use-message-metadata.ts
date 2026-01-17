/**
 * Hook for fetching message metadata (tokens, model info)
 */

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface MessageMetadata {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
}

export function useMessageMetadata(messageId: string | null) {
  const metadata = useQuery(
    api.message_metadata.getMessageMetadata,
    messageId ? { messageId } : 'skip',
  );

  return {
    metadata: metadata
      ? {
          model: metadata.model,
          provider: metadata.provider,
          inputTokens: metadata.inputTokens,
          outputTokens: metadata.outputTokens,
          totalTokens: metadata.totalTokens,
          reasoningTokens: metadata.reasoningTokens,
          cachedInputTokens: metadata.cachedInputTokens,
          reasoning: metadata.reasoning,
          durationMs: metadata.durationMs,
          timeToFirstTokenMs: metadata.timeToFirstTokenMs,
        }
      : undefined,
    isLoading: metadata === undefined && messageId !== null,
  };
}
