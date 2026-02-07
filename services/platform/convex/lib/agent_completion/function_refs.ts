/**
 * Type-safe function references for agent completion module.
 *
 * This module provides strongly-typed function references that can be used
 * with ctx.runMutation() without TS2589 errors.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from '../function_refs/create_ref';

/**
 * Type definition for saveMessageMetadata mutation.
 */
export type SaveMessageMetadataRef = FunctionReference<
  'mutation',
  'internal',
  {
    messageId: string;
    threadId: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    reasoning?: string;
    durationMs?: number;
    timeToFirstTokenMs?: number;
    subAgentUsage?: Array<{
      toolName: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }>;
    contextWindow?: string;
    contextStats?: {
      totalTokens: number;
      messageCount: number;
      approvalCount: number;
      hasRag: boolean;
      hasIntegrations: boolean;
    };
  },
  null
>;

/**
 * Get the function reference for saveMessageMetadata.
 */
export function getSaveMessageMetadataRef(): SaveMessageMetadataRef {
  return createRef<SaveMessageMetadataRef>('internal', ['message_metadata', 'mutations', 'saveMessageMetadata']);
}
