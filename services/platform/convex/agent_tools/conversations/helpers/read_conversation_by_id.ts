import type { ToolCtx } from '@convex-dev/agent';

import { isKeyOf } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import {
  defaultConversationGetFields,
  type ConversationReadGetByIdResult,
} from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readConversationById(
  ctx: ToolCtx,
  args: { conversationId: string; fields?: string[] },
): Promise<ConversationReadGetByIdResult> {
  const { organizationId } = ctx;

  debugLog('tool:conversation_read get_by_id start', {
    organizationId,
    conversationId: args.conversationId,
  });

  const conversationId = toId<'conversations'>(args.conversationId);

  const conversation = await ctx.runQuery(
    internal.conversations.internal_queries.getConversationById,
    { conversationId },
  );

  if (!conversation || conversation.organizationId !== organizationId) {
    debugLog('tool:conversation_read get_by_id not found', {
      organizationId,
      conversationId: args.conversationId,
    });

    return {
      operation: 'get_by_id',
      conversation: null,
    };
  }

  const fields = args.fields ?? defaultConversationGetFields;

  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isKeyOf(f, conversation)) {
      out[f] = conversation[f];
    }
  }
  if (!('_id' in out)) {
    out._id = conversation._id;
  }

  const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
  debugLog('tool:conversation_read get_by_id return', {
    conversationId: args.conversationId,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    conversation: out,
  };
}
