/**
 * Hook for fetching message metadata (tokens, model info)
 */

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface SubAgentUsage {
  toolName: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  approvalCount: number;
  hasSummary: boolean;
  hasRag: boolean;
  hasIntegrations: boolean;
}

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
  subAgentUsage?: SubAgentUsage[];
  contextWindow?: string;
  contextStats?: ContextStats;
}

export function useMessageMetadata(messageId: string | null) {
  const metadata = useQuery(
    api.message_metadata.queries.getMessageMetadata,
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
          subAgentUsage: metadata.subAgentUsage,
          contextWindow: metadata.contextWindow,
          contextStats: metadata.contextStats,
        }
      : undefined,
    isLoading: metadata === undefined && messageId !== null,
  };
}
