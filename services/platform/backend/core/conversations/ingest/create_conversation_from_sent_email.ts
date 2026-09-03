import type { ActionCtx } from '../../lib/ctx';
import { createDebugLog } from '../../lib/debug_log';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import { emailDomain, sameMailboxAliasDomain } from '../reply_from';
import { addMessageToConversation } from './add_message_to_conversation';
import { buildConversationMetadata } from './build_conversation_metadata';
import { buildInitialMessage } from './build_initial_message';
import { checkConversationExists } from './check_conversation_exists';
import { checkMessageExists } from './check_message_exists';
import { MAX_EMAILS_PER_BATCH, NO_SUBJECT } from './constants';
import { byEmailDateAscending, tipOfEmails } from './email_epoch';
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

function listIncludes(
  list: Array<{ address: string; name?: string }> | undefined,
  addr: string | undefined,
) {
  return (
    !!addr &&
    !!list?.some((x) => x.address?.toLowerCase() === addr.toLowerCase())
  );
}

function registerInBatch(
  inBatchMap: Map<string, Id<'conversations'>>,
  messageId: string | undefined,
  conversationId: Id<'conversations'>,
) {
  const normalized = normalizeExternalMessageId(messageId);
  if (normalized) inBatchMap.set(normalized, conversationId);
}

function identifyCustomerAndAgent(
  email: EmailType,
  explicitAgent: string | undefined,
): { customerEmail?: string; accountEmailLower?: string } {
  let accountEmailLower = explicitAgent;
  let customerEmail: string | undefined;

  if (accountEmailLower) {
    if (listIncludes(email.from, accountEmailLower)) {
      customerEmail = email.to?.[0]?.address?.toLowerCase();
    } else if (listIncludes(email.to, accountEmailLower)) {
      customerEmail = email.from?.[0]?.address?.toLowerCase();
    } else {
      const agentDomain = emailDomain(accountEmailLower);
      const fromAddr = email.from?.[0]?.address?.toLowerCase();
      const toAddrs =
        email.to
          ?.map((entry) => entry.address?.toLowerCase())
          .filter((addr): addr is string => !!addr) ?? [];

      // Sent-folder outbound with reply-as From (billing@) while account is hello@.
      // Public domains (gmail.com, …) are not org aliases — a different
      // @gmail.com From is another person, not this mailbox. Leave customer
      // unset so the message is skipped rather than attributed to a stranger.
      if (fromAddr && sameMailboxAliasDomain(fromAddr, accountEmailLower)) {
        customerEmail =
          toAddrs.find((addr) => emailDomain(addr) !== agentDomain) ??
          toAddrs[0];
      }
    }
  } else if (email.to?.length === 1) {
    customerEmail = email.to[0].address?.toLowerCase();
    accountEmailLower = email.from?.[0]?.address?.toLowerCase();
  } else {
    customerEmail = email.from?.[0]?.address?.toLowerCase();
    accountEmailLower = email.to?.[0]?.address?.toLowerCase();
  }

  return { customerEmail, accountEmailLower };
}

export async function createConversationFromSentEmail(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    emails: unknown;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    accountEmail?: string;
    type?: string;
    connectorName?: string;
  },
) {
  const emailsArray: EmailType[] = normalizeEmails(params.emails);

  if (emailsArray.length === 0) {
    return {
      conversationId: null,
      created: false,
      reason: 'no_emails',
      ingestedTip: null,
    };
  }

  emailsArray.sort(byEmailDateAscending);

  if (emailsArray.length > MAX_EMAILS_PER_BATCH) {
    debugLog(
      'create_from_sent_email Truncating emails from',
      emailsArray.length,
      'to',
      MAX_EMAILS_PER_BATCH,
    );
    emailsArray.length = MAX_EMAILS_PER_BATCH;
  }

  // The tip of the window this pass covers — the sync advances the outbound
  // watermark only to here, so a truncated (newer) sent message re-lists next
  // pass instead of being stepped over.
  const ingestedTip = tipOfEmails(emailsArray);

  debugLog('create_from_sent_email Processing', emailsArray.length, 'emails');

  const explicitAgent = params.accountEmail?.toLowerCase();
  const inBatchMap = new Map<string, Id<'conversations'>>();
  const customerEmailByConversation = new Map<string, string>();
  const conversationIds = new Set<Id<'conversations'>>();

  let lastConversationId: Id<'conversations'> | null = null;
  let anyCreated = false;
  let processedCount = 0;
  let skippedCount = 0;
  let newMessagesAdded = 0;

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
        'create_from_sent_email Message already exists, updating:',
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
      lastConversationId = existingRootConversation._id;
      conversationIds.add(existingRootConversation._id);
      processedCount++;
      registerInBatch(
        inBatchMap,
        email.messageId,
        existingRootConversation._id,
      );
      const customerEmail = contactEmailFromConversationMetadata(
        existingRootConversation.metadata,
        existingRootConversation.direction,
      );
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

    const { customerEmail } = identifyCustomerAndAgent(email, explicitAgent);

    if (!customerEmail) {
      debugLog(
        'create_from_sent_email Could not determine customer email for message:',
        email.messageId,
      );
      skippedCount++;
      continue;
    }

    if (targetConversationId) {
      const isCustomer =
        email.from?.[0]?.address?.toLowerCase() === customerEmail;

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
      newMessagesAdded++;
      registerInBatch(inBatchMap, email.messageId, targetConversationId);
      customerEmailByConversation.set(targetConversationId, customerEmail);
      continue;
    }

    const rootDirection: 'inbound' | 'outbound' = listIncludes(
      email.from,
      customerEmail,
    )
      ? 'inbound'
      : 'outbound';

    const contactResult = await findOrCreateContactFromEmail(
      ctx,
      params.organizationId,
      email,
      rootDirection,
    );

    if (!contactResult) {
      skippedCount++;
      continue;
    }

    const isFromCustomer =
      email.from?.[0]?.address?.toLowerCase() === customerEmail;
    const conversationDirection: 'inbound' | 'outbound' = isFromCustomer
      ? 'inbound'
      : 'outbound';

    const created = await ctx.runMutation(
      internal.conversations.internal_mutations.createConversationWithMessage,
      {
        organizationId: params.organizationId,
        contactId: contactResult.contactId,
        externalMessageId: normalizeExternalMessageId(email.messageId),
        subject: email.subject || NO_SUBJECT,
        status: params.status ?? 'open',
        priority: params.priority,
        type: params.type || 'general',
        channel: 'email',
        direction: conversationDirection,
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

    lastConversationId = created.conversationId;
    conversationIds.add(created.conversationId);
    anyCreated = true;
    processedCount++;
    newMessagesAdded++;
    registerInBatch(inBatchMap, email.messageId, created.conversationId);
    customerEmailByConversation.set(created.conversationId, customerEmail);
    debugLog(
      'create_from_sent_email Created conversation:',
      created.conversationId,
    );
  }

  if (processedCount === 0 && skippedCount > 0) {
    return {
      conversationId: null,
      created: false,
      reason: 'no_message_id',
      processedCount,
      skippedCount,
      conversationIds: [],
      ingestedTip,
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
    newMessagesAdded,
    ingestedTip,
  };
}
