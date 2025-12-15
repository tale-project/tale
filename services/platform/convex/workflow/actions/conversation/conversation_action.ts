/**
 * Conversation-specific workflow actions
 *
 * These actions provide safe, specialized operations for conversation data in workflows.
 * They replace generic database operations with purpose-built functions that:
 * - Use Convex indexes for efficient queries
 * - Require organizationId or conversationId to prevent accidental bulk operations
 * - Use lodash for safe nested metadata updates
 * - Support flexible filtering on status, priority, and metadata fields
 * - Follow Convex best practices
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { Id } from '../../../_generated/dataModel';
import { createConversation } from './helpers/create_conversation';
import { queryConversationMessages } from './helpers/query_conversation_messages';
import { queryLatestMessageByDeliveryState } from './helpers/query_latest_message_by_delivery_state';
import { updateConversations } from './helpers/update_conversations';
import { createConversationFromEmail } from './helpers/create_conversation_from_email';
import { createConversationFromSentEmail } from './helpers/create_conversation_from_sent_email';
import type { ConversationStatus } from './helpers/types';

// Common field validators
const paginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
});

const directionValidator = v.union(v.literal('inbound'), v.literal('outbound'));

const deliveryStateValidator = v.union(
  v.literal('queued'),
  v.literal('sent'),
  v.literal('delivered'),
  v.literal('failed'),
);

// Status validator matching ConversationStatus type
const statusValidator = v.union(
  v.literal('open'),
  v.literal('closed'),
  v.literal('archived'),
  v.literal('spam'),
);

// Type for conversation operation params (discriminated union)
// Note: This type is maintained separately from the parametersValidator for clarity.
// The TypeScript type provides IDE support, while the validator provides runtime validation.
type ConversationActionParams =
  | {
      operation: 'create';
      customerId?: Id<'customers'>;
      subject?: string;
      status?: ConversationStatus;
      priority?: string;
      type?: string;
      channel?: string;
      direction?: 'inbound' | 'outbound';
      providerId?: Id<'emailProviders'>;
      metadata?: Record<string, unknown>;
    }
  | {
      operation: 'query_messages';
      paginationOpts: { numItems: number; cursor: string | null };
      conversationId?: Id<'conversations'>;
      channel?: string;
      direction?: 'inbound' | 'outbound';
    }
  | {
      operation: 'query_latest_message_by_delivery_state';
      channel: string;
      direction: 'inbound' | 'outbound';
      deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
      providerId?: Id<'emailProviders'>;
    }
  | {
      operation: 'update';
      conversationId: Id<'conversations'>;
      updates: Record<string, unknown>;
    }
  | {
      operation: 'create_from_email';
      emails: unknown;
      status?: ConversationStatus;
      priority?: string;
      providerId?: Id<'emailProviders'>;
      type?: string;
    }
  | {
      operation: 'create_from_sent_email';
      emails: unknown;
      accountEmail?: string;
      status?: ConversationStatus;
      priority?: string;
      providerId?: Id<'emailProviders'>;
      type?: string;
    };

export const conversationAction: ActionDefinition<ConversationActionParams> = {
  type: 'conversation',
  title: 'Conversation Operation',
  description:
    'Execute conversation-specific operations (create, query_messages, query_latest_message_by_delivery_state, update, create_from_email, create_from_sent_email). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create: Create a new conversation
    v.object({
      operation: v.literal('create'),
      customerId: v.optional(v.id('customers')),
      subject: v.optional(v.string()),
      status: v.optional(statusValidator),
      priority: v.optional(v.string()),
      type: v.optional(v.string()),
      channel: v.optional(v.string()),
      direction: v.optional(directionValidator),
      providerId: v.optional(v.id('emailProviders')),
      metadata: v.optional(v.any()),
    }),
    // query_messages: Query conversation messages with pagination
    v.object({
      operation: v.literal('query_messages'),
      paginationOpts: paginationOptsValidator,
      conversationId: v.optional(v.id('conversations')),
      channel: v.optional(v.string()),
      direction: v.optional(directionValidator),
    }),
    // query_latest_message_by_delivery_state: Query latest message by delivery state
    v.object({
      operation: v.literal('query_latest_message_by_delivery_state'),
      channel: v.string(),
      direction: directionValidator,
      deliveryState: deliveryStateValidator,
      providerId: v.optional(v.id('emailProviders')),
    }),
    // update: Update a conversation by ID
    v.object({
      operation: v.literal('update'),
      conversationId: v.id('conversations'),
      updates: v.any(),
    }),
    // create_from_email: Create conversation from inbound email
    v.object({
      operation: v.literal('create_from_email'),
      emails: v.any(),
      status: v.optional(statusValidator),
      priority: v.optional(v.string()),
      providerId: v.optional(v.id('emailProviders')),
      type: v.optional(v.string()),
    }),
    // create_from_sent_email: Create conversation from sent email
    v.object({
      operation: v.literal('create_from_sent_email'),
      emails: v.any(),
      accountEmail: v.optional(v.string()),
      status: v.optional(statusValidator),
      priority: v.optional(v.string()),
      providerId: v.optional(v.id('emailProviders')),
      type: v.optional(v.string()),
    }),
  ),
  async execute(ctx, params, variables) {
    // Read and validate organizationId from workflow context variables
    const organizationId = variables?.organizationId;

    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'conversation action requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {
        return await createConversation(ctx, {
          organizationId,
          customerId: params.customerId,
          subject: params.subject,
          status: params.status,
          priority: params.priority,
          type: params.type,
          channel: params.channel,
          direction: params.direction,
          providerId: params.providerId,
          metadata: params.metadata,
        });
      }

      case 'query_messages': {
        return await queryConversationMessages(ctx, {
          organizationId,
          conversationId: params.conversationId,
          channel: params.channel,
          direction: params.direction,
          paginationOpts: params.paginationOpts, // Required by validator
        });
      }

      case 'query_latest_message_by_delivery_state': {
        return await queryLatestMessageByDeliveryState(ctx, {
          organizationId,
          channel: params.channel, // Required by validator
          direction: params.direction, // Required by validator
          deliveryState: params.deliveryState, // Required by validator
          providerId: params.providerId,
        });
      }

      case 'update': {
        return await updateConversations(ctx, {
          organizationId, // For organization ownership validation
          conversationId: params.conversationId, // Required by validator
          updates: params.updates, // Required by validator
        });
      }

      case 'create_from_email': {
        return await createConversationFromEmail(ctx, {
          organizationId,
          emails: params.emails, // Required by validator
          status: params.status,
          priority: params.priority,
          providerId: params.providerId,
          type: params.type,
        });
      }

      case 'create_from_sent_email': {
        return await createConversationFromSentEmail(ctx, {
          organizationId,
          emails: params.emails, // Required by validator
          status: params.status,
          priority: params.priority,
          providerId: params.providerId,
          accountEmail: params.accountEmail,
          type: params.type,
        });
      }

      default:
        throw new Error(
          `Unsupported conversation operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
