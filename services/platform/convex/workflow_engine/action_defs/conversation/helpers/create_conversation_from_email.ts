import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { EmailType, ConversationStatus, ConversationPriority } from './types';
import { checkMessageExists } from './check_message_exists';
import { checkConversationExists } from './check_conversation_exists';
import { findOrCreateCustomerFromEmail } from './find_or_create_customer_from_email';
import { addMessageToConversation } from './add_message_to_conversation';
import { updateMessage } from './update_message';
import { buildInitialMessage } from './build_initial_message';
import { buildConversationMetadata } from './build_conversation_metadata';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

// Helper to extract the first (root) message ID from References header
function extractRootMessageId(email: EmailType): string | null {
  if (!email.headers) return null;

  const references = email.headers['references'];
  if (!references) return null;

  // Split by comma and/or whitespace, get the first message ID
  const refIds = references
    .split(/,\s*|\s+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== ',');

  return refIds.length > 0 ? refIds[0] : null;
}

export async function createConversationFromEmail(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    emails: unknown;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    providerId?: Id<'emailProviders'>;
    type?: string;
  },
) {
  // Handle both single email and array of emails
  const emailsArray: EmailType[] = Array.isArray(params.emails)
    ? (params.emails as EmailType[])
    : [params.emails as EmailType];

  // Sort emails by date (chronological order - oldest first)
  emailsArray.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  debugLog('create_from_email Processing', emailsArray.length, 'emails');

  // Determine the root message ID for the conversation
  // Priority:
  // 1. First message ID in References header (if available)
  // 2. The oldest email's message ID
  let rootMessageId: string;
  let rootEmail: EmailType;

  // Try to find the root message ID from References header
  const firstEmailWithReferences = emailsArray.find(
    (email) => email.headers && email.headers['references'],
  );

  if (firstEmailWithReferences) {
    const referencesRootId = extractRootMessageId(firstEmailWithReferences);
    if (referencesRootId) {
      debugLog(
        'create_from_email Found root message ID from References:',
        referencesRootId,
      );

      // Try to find this message in our fetched emails
      const rootEmailFromReferences = emailsArray.find(
        (email) => email.messageId === referencesRootId,
      );

      if (rootEmailFromReferences) {
        debugLog('create_from_email Root message found in fetched emails');
        rootEmail = rootEmailFromReferences;
        rootMessageId = referencesRootId;
      } else {
        debugLog(
          'create_from_email Root message not in fetched emails, checking if conversation exists...',
        );
        // Check if a conversation already exists for this root message ID
        const existingConvForRoot = await checkConversationExists(
          ctx,
          params.organizationId,
          referencesRootId,
        );

        if (existingConvForRoot) {
          debugLog(
            'create_from_email Found existing conversation for root message:',
            existingConvForRoot._id,
          );
          // Add all emails as messages to this existing conversation
          for (const email of emailsArray) {
            // Check if message already exists
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
              // Update existing message with delivered state and metadata
              await updateMessage(ctx, existingMessage._id, email);
              continue;
            }

            // Determine if this is from the customer based on the conversation's stored root sender
            const convRootFrom = (existingConvForRoot.metadata as any)?.from as
              | Array<{ address?: string; name?: string }>
              | undefined;
            const convCustomerAddress = convRootFrom?.[0]?.address;
            const isCustomer = email.from[0]?.address === convCustomerAddress;

            await addMessageToConversation(
              ctx,
              existingConvForRoot._id,
              params.organizationId,
              email,
              isCustomer,
              'delivered',
              params.providerId,
            );
          }

          // Note: execute_action_node wraps this in output: { type: 'action', data: result }
          return {
            conversationId: existingConvForRoot._id,
            created: false,
            isThreaded: emailsArray.length > 1,
            messageCount: emailsArray.length,
          };
        }

        // Root message not found, use oldest email as root
        debugLog(
          'create_from_email Root message not found, using oldest email as root',
        );
        rootEmail = emailsArray[0];
        rootMessageId = rootEmail.messageId;
      }
    } else {
      // No valid root ID in References, use oldest email
      rootEmail = emailsArray[0];
      rootMessageId = rootEmail.messageId;
    }
  } else {
    // No References header, use oldest email
    rootEmail = emailsArray[0];
    rootMessageId = rootEmail.messageId;
  }

  debugLog('create_from_email Using root message ID:', rootMessageId);

  // Check if conversation already exists for the root email
  const existingConversation = await checkConversationExists(
    ctx,
    params.organizationId,
    rootMessageId,
  );

  let conversationId: Id<'conversations'>;
  let conversationCreated: boolean;
  let senderEmail: string | undefined;

  // If conversation exists, use it
  if (existingConversation) {
    debugLog(
      'create_from_email Conversation already exists:',
      existingConversation._id,
    );
    conversationId = existingConversation._id;
    conversationCreated = false;
    senderEmail = rootEmail.from[0]?.address;
  } else {
    // Find or create customer
    const customerResult = await findOrCreateCustomerFromEmail(
      ctx,
      params.organizationId,
      rootEmail,
      'inbound',
    );

    if (!customerResult) {
      // Note: execute_action_node wraps this in output: { type: 'action', data: result }
      return {
        conversationId: null,
        created: false,
        reason: 'no_sender',
      };
    }

    senderEmail = customerResult.email;

    // Create new conversation with initial message
    debugLog('create_from_email Creating conversation from root email');
    const result = await ctx.runMutation(
      internal.conversations.internal_mutations.createConversationWithMessage,
      {
        organizationId: params.organizationId,
        customerId: customerResult.customerId,
        externalMessageId: rootEmail.messageId,
        subject: rootEmail.subject || '(no subject)',
        status: params.status ?? 'open',
        priority: params.priority,
        type: params.type || 'general',
        channel: 'email',
        direction: 'inbound',
        providerId: params.providerId,
        metadata: buildConversationMetadata(rootEmail, {
          isThreaded: emailsArray.length > 1,
          threadMessageCount: emailsArray.length,
        }),
        initialMessage: buildInitialMessage(rootEmail, true, 'delivered'),
      },
    );

    conversationId = result.conversationId;
    conversationCreated = true;
    debugLog('create_from_email Created conversation:', conversationId);
  }

  // Create conversationMessages for remaining emails in the thread
  // Add all emails except the root email (which was used to create the conversation)
  const emailsToAdd = emailsArray.filter(
    (email) => email.messageId !== rootMessageId,
  );

  if (emailsToAdd.length > 0) {
    debugLog(
      'create_from_email Creating',
      emailsToAdd.length,
      'additional messages',
    );

    for (const email of emailsToAdd) {
      // Check if this message already exists
      const existingMsg = await checkMessageExists(
        ctx,
        params.organizationId,
        email.messageId,
      );

      if (existingMsg) {
        debugLog(
          'create_from_email Message already exists, updating:',
          email.messageId,
        );
        // Update existing message with delivered state and metadata
        await updateMessage(ctx, existingMsg._id, email);
        continue;
      }

      // Determine if this is from customer or agent
      const isCustomer = email.from[0]?.address === senderEmail;

      await addMessageToConversation(
        ctx,
        conversationId,
        params.organizationId,
        email,
        isCustomer,
        'delivered',
        params.providerId,
      );

      debugLog('create_from_email Created message:', email.messageId);
    }
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return {
    conversationId,
    created: conversationCreated,
    isThreaded: emailsArray.length > 1,
    messageCount: emailsArray.length,
  };
}
