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
import { getConversationById } from './helpers/get_conversation_by_id';
import { queryConversations } from './helpers/query_conversations';
import { queryConversationMessages } from './helpers/query_conversation_messages';
import { queryLatestMessageByDeliveryState } from './helpers/query_latest_message_by_delivery_state';
import { updateConversations } from './helpers/update_conversations';
import { createConversationFromEmail } from './helpers/create_conversation_from_email';
import { createConversationFromSentEmail } from './helpers/create_conversation_from_sent_email';
import type { ConversationStatus } from './helpers/types';

export const conversationAction: ActionDefinition<{
  operation:
    | 'create'
    | 'get_by_id'
    | 'query'
    | 'query_messages'
    | 'query_latest_message_by_delivery_state'
    | 'update'
    | 'create_from_email'
    | 'create_from_sent_email';
  conversationId?: Id<'conversations'>;
  organizationId?: string;
  customerId?: Id<'customers'>;
  subject?: string;
  status?: ConversationStatus;
  priority?: string;
  type?: string;
  channel?: string;
  direction?: 'inbound' | 'outbound';
  providerId?: Id<'emailProviders'>;
  deliveryState?: 'queued' | 'sent' | 'delivered' | 'failed';

  metadata?: Record<string, unknown>;

  updates?: Record<string, unknown>;
  email?: unknown; // Single email object
  emails?: unknown; // Array of email objects for threaded conversations
  accountEmail?: string; // Mailbox address of the account/mailbox being synced
  paginationOpts?: {
    numItems: number;
    cursor: string | null;
  };
}> = {
  type: 'conversation',
  title: 'Conversation Operation',
  description:
    'Execute conversation-specific operations (create, get_by_id, query, query_messages, update, create_from_email, create_from_sent_email)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('create'),
      v.literal('get_by_id'),
      v.literal('query'),
      v.literal('query_messages'),
      v.literal('query_latest_message_by_delivery_state'),
      v.literal('update'),
      v.literal('create_from_email'),
      v.literal('create_from_sent_email'),
    ),
    conversationId: v.optional(v.id('conversations')),
    organizationId: v.optional(v.string()),
    customerId: v.optional(v.id('customers')),
    subject: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    type: v.optional(v.string()),
    channel: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    providerId: v.optional(v.id('emailProviders')),

    metadata: v.optional(v.any()),
    updates: v.optional(v.any()),
    email: v.optional(v.any()), // Single email object
    emails: v.optional(v.any()), // Array of email objects for threaded conversations
    accountEmail: v.optional(v.string()),
    paginationOpts: v.optional(
      v.object({
        numItems: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
  }),
  async execute(ctx, params) {
    switch (params.operation) {
      case 'create': {
        if (!params.organizationId) {
          throw new Error('create operation requires organizationId parameter');
        }

        return await createConversation(ctx, {
          organizationId: params.organizationId,
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

      case 'get_by_id': {
        if (!params.conversationId) {
          throw new Error(
            'get_by_id operation requires conversationId parameter',
          );
        }

        return await getConversationById(ctx, {
          conversationId: params.conversationId,
        });
      }

      case 'query': {
        if (!params.organizationId) {
          throw new Error('query operation requires organizationId parameter');
        }

        if (!params.paginationOpts) {
          throw new Error('query operation requires paginationOpts parameter');
        }

        return await queryConversations(ctx, {
          organizationId: params.organizationId,
          customerId: params.customerId,
          status: params.status,
          priority: params.priority,
          channel: params.channel,
          direction: params.direction,
          paginationOpts: params.paginationOpts,
        });
      }

      case 'query_messages': {
        if (!params.organizationId) {
          throw new Error(
            'query_messages operation requires organizationId parameter',
          );
        }

        if (!params.paginationOpts) {
          throw new Error(
            'query_messages operation requires paginationOpts parameter',
          );
        }

        return await queryConversationMessages(ctx, {
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          channel: params.channel,
          direction: params.direction,
          paginationOpts: params.paginationOpts,
        });
      }

      case 'query_latest_message_by_delivery_state': {
        if (!params.organizationId) {
          throw new Error(
            'query_latest_message_by_delivery_state operation requires organizationId parameter',
          );
        }

        if (!params.channel) {
          throw new Error(
            'query_latest_message_by_delivery_state operation requires channel parameter',
          );
        }

        if (!params.direction) {
          throw new Error(
            'query_latest_message_by_delivery_state operation requires direction parameter',
          );
        }

        if (!params.deliveryState) {
          throw new Error(
            'query_latest_message_by_delivery_state operation requires deliveryState parameter',
          );
        }

        return await queryLatestMessageByDeliveryState(ctx, {
          organizationId: params.organizationId,
          channel: params.channel,
          direction: params.direction,
          deliveryState: params.deliveryState,
          providerId: params.providerId,
        });
      }

      case 'update': {
        if (!params.conversationId && !params.organizationId) {
          throw new Error(
            'update operation requires either conversationId or organizationId parameter',
          );
        }
        if (!params.updates) {
          throw new Error('update operation requires updates parameter');
        }

        return await updateConversations(ctx, {
          conversationId: params.conversationId,
          organizationId: params.organizationId,
          status: params.status,
          priority: params.priority,
          updates: params.updates,
        });
      }

      case 'create_from_email': {
        if (!params.organizationId) {
          throw new Error(
            'create_from_email operation requires organizationId parameter',
          );
        }
        if (!params.emails) {
          throw new Error(
            'create_from_email operation requires emails parameter',
          );
        }

        return await createConversationFromEmail(ctx, {
          organizationId: params.organizationId,
          emails: params.emails,
          status: params.status,
          priority: params.priority,
          providerId: params.providerId,
          type: params.type,
        });
      }

      case 'create_from_sent_email': {
        if (!params.organizationId) {
          throw new Error(
            'create_from_sent_email operation requires organizationId parameter',
          );
        }
        if (!params.emails) {
          throw new Error(
            'create_from_sent_email operation requires emails parameter',
          );
        }

        return await createConversationFromSentEmail(ctx, {
          organizationId: params.organizationId,
          emails: params.emails,
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
