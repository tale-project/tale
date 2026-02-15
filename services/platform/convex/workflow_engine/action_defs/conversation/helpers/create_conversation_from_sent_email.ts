import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type {
  EmailType,
  ConversationStatus,
  ConversationPriority,
} from './types';

import { internal } from '../../../../_generated/api';
import { createDebugLog } from '../../../../lib/debug_log';
import { addMessageToConversation } from './add_message_to_conversation';
import { buildConversationMetadata } from './build_conversation_metadata';
import { buildInitialMessage } from './build_initial_message';
import { checkMessageExists } from './check_message_exists';
import { findOrCreateCustomerFromEmail } from './find_or_create_customer_from_email';
import { findRelatedConversation } from './find_related_conversation';
import { updateMessage } from './update_message';

const debugLog = createDebugLog('DEBUG_CONVERSATIONS', '[Conversations]');

export async function createConversationFromSentEmail(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    emails: unknown;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    accountEmail?: string; // The mailbox address of the account/mailbox being synced
    type?: string;
    integrationName?: string;
  },
) {
  // Handle both single email and array of emails
  const emailsArray: EmailType[] = Array.isArray(params.emails)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      (params.emails as EmailType[])
    : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      [params.emails as EmailType];

  // Sort emails by date (chronological order - oldest first)
  emailsArray.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  debugLog('create_from_sent_email Processing', emailsArray.length, 'emails');

  // Use the first (oldest) email as the root
  const rootEmail = emailsArray[0];

  // Check if conversation already exists for the root email
  const existing = await checkMessageExists(
    ctx,
    params.organizationId,
    rootEmail.messageId,
  );

  // Helper: does an address list include a given email?
  const listIncludes = (
    list: Array<{ address: string; name?: string }> | undefined,
    addr: string | undefined,
  ) =>
    !!addr &&
    !!list?.some((x) => x.address?.toLowerCase() === addr.toLowerCase());

  // Collect all unique addresses from the thread
  const allAddresses = new Set<string>();
  for (const email of emailsArray) {
    if (email.from?.[0]?.address)
      allAddresses.add(email.from[0].address.toLowerCase());
    if (email.to?.[0]?.address)
      allAddresses.add(email.to[0].address.toLowerCase());
  }

  // Prefer explicit accountEmail if provided (most reliable)
  const explicitAgent = params.accountEmail?.toLowerCase();

  if (existing) {
    debugLog(
      'create_from_sent_email Root conversation already exists:',
      existing.conversationId,
      '- checking for new messages to add',
    );

    // Root conversation exists, but we still need to process any new messages
    const conversationId = existing.conversationId;
    let newMessagesAdded = 0;

    // Process all emails (including root) to add any new messages
    for (const email of emailsArray) {
      // Check if this message already exists
      const existingMsg = await checkMessageExists(
        ctx,
        params.organizationId,
        email.messageId,
      );

      if (existingMsg) {
        debugLog(
          'create_from_sent_email Message already exists, updating:',
          email.messageId,
        );
        // Update existing message with delivered state and metadata
        await updateMessage(ctx, existingMsg._id, email);
        continue;
      }

      // Determine customer email
      let customerEmail: string | undefined;
      let accountEmailLower = explicitAgent;

      if (accountEmailLower) {
        // If root is sent by agent, customer is the first 'to'
        if (listIncludes(rootEmail.from, accountEmailLower)) {
          customerEmail = rootEmail.to?.[0]?.address?.toLowerCase();
        }
        // If root is received by agent, customer is the 'from'
        else if (listIncludes(rootEmail.to, accountEmailLower)) {
          customerEmail = rootEmail.from?.[0]?.address?.toLowerCase();
        }

        // Fallback: pick any address in the thread that isn't the agent
        if (!customerEmail) {
          customerEmail = Array.from(allAddresses).find(
            (addr) => addr !== accountEmailLower,
          );
        }
      } else {
        // No explicit agent provided: fall back to conservative inference from root
        if (rootEmail.to?.length === 1) {
          customerEmail = rootEmail.to[0].address?.toLowerCase();
          accountEmailLower = rootEmail.from?.[0]?.address?.toLowerCase();
        } else {
          customerEmail = rootEmail.from?.[0]?.address?.toLowerCase();
          accountEmailLower = rootEmail.to?.[0]?.address?.toLowerCase();
        }
      }

      if (!customerEmail) {
        debugLog(
          'create_from_sent_email Could not determine customer email for message:',
          email.messageId,
        );
        continue;
      }

      // Determine if this email is from customer or agent
      const isCustomer =
        email.from?.[0]?.address?.toLowerCase() === customerEmail;
      // All emails synced from mailbox should be "delivered" since they exist in the mailbox
      const status: 'delivered' | 'sent' = 'delivered';

      await addMessageToConversation(
        ctx,
        conversationId,
        params.organizationId,
        email,
        isCustomer,
        status,
        params.integrationName,
      );

      newMessagesAdded++;
      debugLog('create_from_sent_email Added new message:', email.messageId);
    }

    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      conversationId,
      created: false,
      reason: 'existing_conversation_updated',
      newMessagesAdded,
      totalMessages: emailsArray.length,
    };
  }

  // Determine agent and customer
  let accountEmailLower = explicitAgent;
  let customerEmail: string | undefined;

  if (accountEmailLower) {
    // If root is sent by agent, customer is the first 'to'
    if (listIncludes(rootEmail.from, accountEmailLower)) {
      customerEmail = rootEmail.to?.[0]?.address?.toLowerCase();
    }
    // If root is received by agent, customer is the 'from'
    else if (listIncludes(rootEmail.to, accountEmailLower)) {
      customerEmail = rootEmail.from?.[0]?.address?.toLowerCase();
    }

    // Fallback: pick any address in the thread that isn't the agent
    if (!customerEmail) {
      customerEmail = Array.from(allAddresses).find(
        (addr) => addr !== accountEmailLower,
      );
    }
  } else {
    // No explicit agent provided: fall back to conservative inference from root
    // If root 'to' has exactly one recipient, assume that is customer and 'from' is agent
    if (rootEmail.to?.length === 1) {
      customerEmail = rootEmail.to[0].address?.toLowerCase();
      accountEmailLower = rootEmail.from?.[0]?.address?.toLowerCase();
    } else {
      // Otherwise assume root sender is customer and receiver is agent
      customerEmail = rootEmail.from?.[0]?.address?.toLowerCase();
      accountEmailLower = rootEmail.to?.[0]?.address?.toLowerCase();
    }
  }

  if (!customerEmail) {
    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      conversationId: null,
      created: false,
      reason: 'no_customer_identified',
    };
  }

  // Find or create customer (direction is based on who sent the root email)
  const rootDirection: 'inbound' | 'outbound' = listIncludes(
    rootEmail.from,
    customerEmail,
  )
    ? 'inbound'
    : 'outbound';

  const customerResult = await findOrCreateCustomerFromEmail(
    ctx,
    params.organizationId,
    rootEmail,
    rootDirection,
  );

  if (!customerResult) {
    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      conversationId: null,
      created: false,
      reason: 'no_recipient',
    };
  }

  // Determine related conversation by In-Reply-To or References
  const relatedConversationId = await findRelatedConversation(
    ctx,
    params.organizationId,
    rootEmail,
  );

  // Ensure we have a conversation container
  let conversationId: Id<'conversations'>;
  let conversationCreated: boolean;

  if (relatedConversationId) {
    // Add message to existing conversation
    conversationId = relatedConversationId;
    conversationCreated = false;

    // Determine if root email is from customer or agent
    const isCustomerRoot =
      rootEmail.from?.[0]?.address?.toLowerCase() === customerEmail;
    // All emails synced from mailbox should be "delivered" since they exist in the mailbox
    const statusRoot: 'delivered' | 'sent' = 'delivered';

    await addMessageToConversation(
      ctx,
      conversationId,
      params.organizationId,
      rootEmail,
      isCustomerRoot,
      statusRoot,
      params.integrationName,
    );
  } else {
    // Create new conversation with initial message
    const rootIsFromCustomer =
      rootEmail.from?.[0]?.address?.toLowerCase() === customerEmail;

    // Conversation direction: inbound if customer sent the root, outbound if agent sent it
    const conversationDirection: 'inbound' | 'outbound' = rootIsFromCustomer
      ? 'inbound'
      : 'outbound';

    const created = await ctx.runMutation(
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
        direction: conversationDirection,
        metadata: buildConversationMetadata(rootEmail, {
          isThreaded: emailsArray.length > 1,
          threadMessageCount: emailsArray.length,
          ...(params.integrationName
            ? { integrationName: params.integrationName }
            : {}),
        }),
        initialMessage: buildInitialMessage(
          rootEmail,
          rootIsFromCustomer,
          'delivered',
          params.integrationName,
        ),
        ...(params.integrationName
          ? { integrationName: params.integrationName }
          : {}),
      },
    );
    conversationId = created.conversationId;
    conversationCreated = true;
    debugLog('create_from_sent_email Created conversation:', conversationId);
  }

  // Add remaining emails as messages to the conversation
  const emailsToAdd = emailsArray.filter(
    (email) => email.messageId !== rootEmail.messageId,
  );

  if (emailsToAdd.length > 0) {
    debugLog(
      'create_from_sent_email Creating',
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
          'create_from_sent_email Message already exists, updating:',
          email.messageId,
        );
        // Update existing message with delivered state and metadata
        await updateMessage(ctx, existingMsg._id, email);
        continue;
      }

      // Determine isCustomer based on sender matching the customer email
      const isCustomer =
        email.from?.[0]?.address?.toLowerCase() === customerEmail;
      // All emails synced from mailbox should be "delivered" since they exist in the mailbox
      const status: 'delivered' | 'sent' = 'delivered';

      await addMessageToConversation(
        ctx,
        conversationId,
        params.organizationId,
        email,
        isCustomer,
        status,
        params.integrationName,
      );

      debugLog('create_from_sent_email Created message:', email.messageId);
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
