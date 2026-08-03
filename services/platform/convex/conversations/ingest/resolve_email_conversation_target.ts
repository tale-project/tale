import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { checkConversationExists } from './check_conversation_exists';
import { checkMessageExists } from './check_message_exists';
import { normalizeExternalMessageId } from './normalize_external_message_id';
import { parseThreadReferenceIds } from './parse_thread_reference_ids';
import type { EmailType } from './types';

async function lookupConversationByMessageId(
  ctx: ActionCtx,
  organizationId: string,
  messageId: string,
  inBatchMap?: Map<string, Id<'conversations'>>,
): Promise<Id<'conversations'> | null> {
  const normalized = normalizeExternalMessageId(messageId);
  if (!normalized) return null;

  const fromBatch = inBatchMap?.get(normalized);
  if (fromBatch) return fromBatch;

  const existingMessage = await checkMessageExists(
    ctx,
    organizationId,
    normalized,
  );
  if (existingMessage?.conversationId) {
    return existingMessage.conversationId;
  }

  const existingConversation = await checkConversationExists(
    ctx,
    organizationId,
    normalized,
  );
  if (existingConversation) return existingConversation._id;

  return null;
}

/**
 * Resolve which conversation an email belongs to via In-Reply-To / References.
 * Returns null when the email should start a new conversation.
 */
export async function resolveEmailConversationTarget(
  ctx: ActionCtx,
  organizationId: string,
  email: EmailType,
  inBatchMap?: Map<string, Id<'conversations'>>,
): Promise<Id<'conversations'> | null> {
  for (const candidateId of parseThreadReferenceIds(email)) {
    const conversationId = await lookupConversationByMessageId(
      ctx,
      organizationId,
      candidateId,
      inBatchMap,
    );
    if (conversationId) return conversationId;
  }

  return null;
}
