import { ConvexError } from 'convex/values';

import { isRecord } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import type { BlockedReason } from '../../governance/stream_transform';
import type { GenerateResponseArgs, GenerateResponseResult } from './types';

export const OUTPUT_BLOCKED_SENTINEL = '[blocked by content policy]';

export function convexErrorToBlockedReason(err: unknown): BlockedReason | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  if (!isRecord(data)) return null;
  const code = data['code'];
  if (
    code !== 'chat_filter.blocked' &&
    code !== 'moderation_provider.blocked'
  ) {
    return null;
  }
  const direction = data['direction'];
  if (direction !== 'input' && direction !== 'output') return null;
  const categoryIds = data['categoryIds'];
  if (!Array.isArray(categoryIds)) return null;
  const runId = data['sanitizationRunId'];
  if (typeof runId !== 'string') return null;
  return {
    code,
    direction,
    categoryIds: categoryIds.filter((c): c is string => typeof c === 'string'),
    sanitizationRunId: runId,
  };
}

export async function applyGuardrailsBlockTombstone(
  ctx: GenerateResponseArgs['ctx'],
  savedMessageId: string | undefined,
  streamId: string | undefined,
  threadId: string,
  reason: BlockedReason,
): Promise<void> {
  if (savedMessageId) {
    try {
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: savedMessageId,
        patch: {
          message: {
            role: 'assistant',
            content: OUTPUT_BLOCKED_SENTINEL,
          },
        },
      });
    } catch (err) {
      console.warn(
        `[guardrails] tombstone updateMessage failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      await ctx.runMutation(
        internal.message_metadata.internal_mutations.setBlockedReason,
        {
          messageId: savedMessageId,
          threadId,
          code: reason.code,
          direction: reason.direction,
          categoryIds: reason.categoryIds,
          sanitizationRunId: reason.sanitizationRunId,
        },
      );
    } catch (err) {
      console.warn(
        `[guardrails] setBlockedReason failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (streamId) {
    try {
      await ctx.runMutation(components.agent.streams.abort, {
        streamId,
        reason: 'blocked_by_content_policy',
      });
    } catch (err) {
      console.warn(
        `[guardrails] streams.abort failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export function buildBlockedReturn(
  threadId: string,
  savedMessageId: string | undefined,
  usage: GenerateResponseResult['usage'] | undefined,
  finishReason: string | undefined,
  startTime: number,
): GenerateResponseResult {
  return {
    threadId,
    text: OUTPUT_BLOCKED_SENTINEL,
    savedMessageId,
    usage,
    finishReason: finishReason ?? 'content-filter',
    durationMs: Date.now() - startTime,
  };
}
