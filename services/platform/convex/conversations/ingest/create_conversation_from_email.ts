import { isRecord, getString } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import { addMessageToConversation } from './add_message_to_conversation';
import { buildConversationMetadata } from './build_conversation_metadata';
import { buildInitialMessage } from './build_initial_message';
import { checkConversationExists } from './check_conversation_exists';
import { checkMessageExists } from './check_message_exists';
import { MAX_EMAILS_PER_BATCH } from './constants';
import { findOrCreateContactFromEmail } from './find_or_create_contact_from_email';
import { normalizeEmails } from './normalize_email';
import { normalizeExternalMessageId } from './normalize_external_message_id';
import { contactEmailFromConversationMetadata } from './resolve_contact_email';
import { resolveEmailConversationTarget } from './resolve_email_conversation_target';
import type {
  EmailType,
  ConversationStatus,
  ConversationPriority,
} from './types';
import { updateMessage } from './update_message';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

/**
 * Determine email direction using the best available signal:
 * 1. email.direction (set by connector, most reliable)
 * 2. accountEmail comparison (explicit param)
 * 3. null (caller must fall back to legacy heuristics)
 */
function resolveDirection(
  email: EmailType,
  accountEmailLower: string | undefined,
): 'inbound' | 'outbound' | null {
  if (email.direction) return email.direction;
  if (accountEmailLower) {
    return email.from[0]?.address?.toLowerCase() === accountEmailLower
      ? 'outbound'
      : 'inbound';
  }
  return null;
}

function customerEmailFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const convRootFromRaw = metadata.from;
  const convRootFrom = Array.isArray(convRootFromRaw)
    ? convRootFromRaw
    : undefined;
  const firstFrom = convRootFrom?.[0];
  return isRecord(firstFrom)
    ? getString(firstFrom, 'address')?.toLowerCase()
    : undefined;
}

function resolveIsCustomer(
  email: EmailType,
  accountEmailLower: string | undefined,
  customerEmail: string | undefined,
): boolean {
  const direction = resolveDirection(email, accountEmailLower);
  if (direction) return direction === 'inbound';
  if (customerEmail) {
    return email.from[0]?.address?.toLowerCase() === customerEmail;
  }
  return true;
}

function registerInBatch(
  inBatchMap: Map<string, Id<'conversations'>>,
  messageId: string | undefined,
  conversationId: Id<'conversations'>,
) {
  const normalized = normalizeExternalMessageId(messageId);
  if (normalized) inBatchMap.set(normalized, conversationId);
}

export async function createConversationFromEmail(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    emails: unknown;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    accountEmail?: string; // Fallback when emails lack direction field
    connectorName?: string;
  },
) {
  const emailsArray: EmailType[] = normalizeEmails(params.emails);

  if (emailsArray.length === 0) {
    return { conversationId: null, created: false, reason: 'no_emails' };
  }

  emailsArray.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  if (emailsArray.length > MAX_EMAILS_PER_BATCH) {
    debugLog(
      'create_from_email Truncating emails from',
      emailsArray.length,
      'to',
      MAX_EMAILS_PER_BATCH,
    );
    emailsArray.length = MAX_EMAILS_PER_BATCH;
  }

  debugLog('create_from_email Processing', emailsArray.length, 'emails');

  const accountEmailLower = params.accountEmail?.toLowerCase();
  const inBatchMap = new Map<string, Id<'conversations'>>();
  const customerEmailByConversation = new Map<string, string>();
  const conversationIds = new Set<Id<'conversations'>>();

  let lastConversationId: Id<'conversations'> | null = null;
  let anyCreated = false;
  let processedCount = 0;
  let skippedCount = 0;

  for (const email of emailsArray) {
    if (!email.messageId) {
      skippedCount++;
      continue;
    }

    const existingMessage = await checkMessageExists(
      ctx,
      params.organizationId,
      email.messageId,
    );

    if (existingMessage) {
      debugLog(
        'create_from_email Message already exists, updating:',
        email.messageId,
      );
      await updateMessage(ctx, existingMessage._id, email);
      lastConversationId = existingMessage.conversationId;
      conversationIds.add(existingMessage.conversationId);
      processedCount++;
      registerInBatch(
        inBatchMap,
        email.messageId,
        existingMessage.conversationId,
      );
      continue;
    }

    const existingRootConversation = await checkConversationExists(
      ctx,
      params.organizationId,
      email.messageId,
    );

    if (existingRootConversation) {
      debugLog(
        'create_from_email Conversation already exists for message:',
        email.messageId,
      );
      lastConversationId = existingRootConversation._id;
      conversationIds.add(existingRootConversation._id);
      processedCount++;
      registerInBatch(
        inBatchMap,
        email.messageId,
        existingRootConversation._id,
      );
      const customerEmail =
        contactEmailFromConversationMetadata(
          existingRootConversation.metadata,
        ) ?? customerEmailFromMetadata(existingRootConversation.metadata);
      if (customerEmail) {
        customerEmailByConversation.set(
          existingRootConversation._id,
          customerEmail,
        );
      }
      continue;
    }

    const targetConversationId = await resolveEmailConversationTarget(
      ctx,
      params.organizationId,
      email,
      inBatchMap,
    );

    if (targetConversationId) {
      debugLog(
        'create_from_email Adding threaded message to conversation:',
        targetConversationId,
      );

      let customerEmail = customerEmailByConversation.get(targetConversationId);
      if (!customerEmail) {
        const conversation = await ctx.runQuery(
          internal.conversations.internal_queries.getConversationById,
          { conversationId: targetConversationId },
        );
        customerEmail =
          contactEmailFromConversationMetadata(
            conversation?.metadata,
            conversation?.direction,
          ) ?? customerEmailFromMetadata(conversation?.metadata);
        if (customerEmail) {
          customerEmailByConversation.set(targetConversationId, customerEmail);
        }
      }

      const isCustomer = resolveIsCustomer(
        email,
        accountEmailLower,
        customerEmail,
      );

      await addMessageToConversation(
        ctx,
        targetConversationId,
        params.organizationId,
        email,
        isCustomer,
        'delivered',
        params.connectorName,
      );

      lastConversationId = targetConversationId;
      conversationIds.add(targetConversationId);
      processedCount++;
      registerInBatch(inBatchMap, email.messageId, targetConversationId);
      continue;
    }

    const direction = resolveDirection(email, accountEmailLower) ?? 'inbound';
    const contactResult = await findOrCreateContactFromEmail(
      ctx,
      params.organizationId,
      email,
      direction,
    );

    if (!contactResult) {
      debugLog(
        'create_from_email Skipping email with no sender/recipient:',
        email.messageId,
      );
      skippedCount++;
      continue;
    }

    const customerEmail = contactResult.email.toLowerCase();
    const isFromCustomer =
      email.from?.[0]?.address?.toLowerCase() === customerEmail;

    debugLog(
      'create_from_email Creating conversation from email:',
      email.messageId,
    );
    const result = await ctx.runMutation(
      internal.conversations.internal_mutations.createConversationWithMessage,
      {
        organizationId: params.organizationId,
        contactId: contactResult.contactId,
        externalMessageId: normalizeExternalMessageId(email.messageId),
        subject: email.subject || '(no subject)',
        status: params.status ?? 'open',
        priority: params.priority,
        type: params.type || 'general',
        channel: 'email',
        direction,
        metadata: buildConversationMetadata(email, {
          isThreaded: false,
          threadMessageCount: 1,
          ...(params.connectorName
            ? { connectorName: params.connectorName }
            : {}),
        }),
        initialMessage: buildInitialMessage(
          email,
          isFromCustomer,
          'delivered',
          params.connectorName,
        ),
        ...(params.connectorName
          ? { connectorName: params.connectorName }
          : {}),
      },
    );

    lastConversationId = result.conversationId;
    conversationIds.add(result.conversationId);
    anyCreated = true;
    processedCount++;
    registerInBatch(inBatchMap, email.messageId, result.conversationId);
    customerEmailByConversation.set(result.conversationId, customerEmail);
  }

  if (processedCount === 0 && skippedCount > 0) {
    return {
      conversationId: null,
      created: false,
      reason: 'no_message_id',
      processedCount,
      skippedCount,
      conversationIds: [],
    };
  }

  const uniqueConversationIds = [...conversationIds];

  return {
    conversationId: lastConversationId,
    conversationIds: uniqueConversationIds,
    created: anyCreated,
    isThreaded: uniqueConversationIds.length === 1 && processedCount > 1,
    messageCount: processedCount,
    processedCount,
    skippedCount,
  };
}
