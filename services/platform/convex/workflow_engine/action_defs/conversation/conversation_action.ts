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

import type { Id } from '../../../_generated/dataModel';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { ConversationStatus, ConversationPriority } from './helpers/types';

import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../../../lib/shared/schemas/utils/json-value';
import { createConversation } from './helpers/create_conversation';
import { createConversationFromEmail } from './helpers/create_conversation_from_email';
import { createConversationFromSentEmail } from './helpers/create_conversation_from_sent_email';
import { queryConversationMessages } from './helpers/query_conversation_messages';
import { queryLatestMessageByDeliveryState } from './helpers/query_latest_message_by_delivery_state';
import { updateConversations } from './helpers/update_conversations';

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

// Priority validator matching ConversationPriority type
const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

// DraftMessage validator for creating outbound messages with approval
const draftMessageValidator = v.object({
  priority: priorityValidator,
  description: v.optional(v.string()),
  dueDate: v.optional(v.number()),
  content: v.string(),
  subject: v.optional(v.string()),
  recipients: v.array(v.string()),
  ccRecipients: v.optional(v.array(v.string())),
  bccRecipients: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
});

// Type for conversation operation params (discriminated union)
// Note: This type is maintained separately from the parametersValidator for clarity.
// The TypeScript type provides IDE support, while the validator provides runtime validation.
// DraftMessage type for TypeScript support
type DraftMessage = {
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description?: string;
  dueDate?: number;
  content: string;
  subject?: string;
  recipients: Array<string>;
  ccRecipients?: Array<string>;
  bccRecipients?: Array<string>;
  metadata?: Record<string, unknown>;
};

type ConversationActionParams =
  | {
      operation: 'create';
      customerId?: Id<'customers'>;
      subject?: string;
      status?: ConversationStatus;
      priority?: ConversationPriority;
      type?: string;
      channel?: string;
      direction?: 'inbound' | 'outbound';
      metadata?: Record<string, unknown>;
      draftMessage?: DraftMessage;
    }
  | {
      operation: 'get_by_id';
      conversationId: Id<'conversations'>;
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
      integrationName?: string;
    }
  | {
      operation: 'update';
      conversationId: Id<'conversations'>;
      updates: Record<string, unknown>;
    }
  | {
      operation: 'create_from_email';
      emails: unknown;
      accountEmail?: string;
      status?: ConversationStatus;
      priority?: ConversationPriority;
      type?: string;
      integrationName?: string;
    }
  | {
      operation: 'create_from_sent_email';
      emails: unknown;
      accountEmail?: string;
      status?: ConversationStatus;
      priority?: ConversationPriority;
      type?: string;
      integrationName?: string;
    };

export const conversationAction: ActionDefinition<ConversationActionParams> = {
  type: 'conversation',
  title: 'Conversation Operation',
  description: `Execute conversation-specific operations (create, get_by_id, query_messages, query_latest_message_by_delivery_state, update, create_from_email, create_from_sent_email). organizationId is automatically read from workflow context variables.

FOR OUTBOUND MESSAGES WITH APPROVAL:
Use the 'draftMessage' parameter when creating conversations to automatically create a pending approval.
When draftMessage is provided:
- direction is automatically set to 'outbound'
- A pending approval is created with resourceType: 'conversations'

draftMessage fields:
- content: Message body (required) - email body, SMS text, etc.
- subject: Subject line (optional) - for email
- recipients: Array of recipients (required) - email addresses, phone numbers, etc.
- ccRecipients: CC recipients (optional) - for email
- bccRecipients: BCC recipients (optional) - for email
- priority: 'low' | 'medium' | 'high' | 'urgent' (required)
- description: Approval description (optional)
- metadata: Additional channel-specific data (optional)

See 'product_recommendation_email' predefined workflow for complete example.`,
  parametersValidator: v.union(
    // create: Create a new conversation (with optional draftMessage for automatic approval)
    v.object({
      operation: v.literal('create'),
      customerId: v.optional(v.id('customers')),
      subject: v.optional(v.string()),
      status: v.optional(statusValidator),
      priority: v.optional(priorityValidator),
      type: v.optional(v.string()),
      channel: v.optional(v.string()),
      direction: v.optional(directionValidator),
      metadata: v.optional(jsonRecordValidator),
      draftMessage: v.optional(draftMessageValidator),
    }),
    // get_by_id: Get a conversation by ID
    v.object({
      operation: v.literal('get_by_id'),
      conversationId: v.id('conversations'),
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
      integrationName: v.optional(v.string()),
    }),
    // update: Update a conversation by ID
    v.object({
      operation: v.literal('update'),
      conversationId: v.id('conversations'),
      updates: v.record(v.string(), jsonValueValidator),
    }),
    // create_from_email: Create conversation from email (supports both inbound and outbound via accountEmail)
    v.object({
      operation: v.literal('create_from_email'),
      emails: jsonValueValidator,
      accountEmail: v.optional(v.string()),
      status: v.optional(statusValidator),
      priority: v.optional(priorityValidator),
      type: v.optional(v.string()),
      integrationName: v.optional(v.string()),
    }),
    // create_from_sent_email: Create conversation from sent email
    v.object({
      operation: v.literal('create_from_sent_email'),
      emails: jsonValueValidator,
      accountEmail: v.optional(v.string()),
      status: v.optional(statusValidator),
      priority: v.optional(priorityValidator),
      type: v.optional(v.string()),
      integrationName: v.optional(v.string()),
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
          metadata: params.metadata,
          draftMessage: params.draftMessage,
        });
      }

      case 'get_by_id': {
        const { internal } = await import('../../../_generated/api');
        return await ctx.runQuery(
          internal.conversations.internal_queries.getConversationById,
          {
            conversationId: params.conversationId,
          },
        );
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
          channel: params.channel,
          direction: params.direction,
          deliveryState: params.deliveryState,
          integrationName: params.integrationName,
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
        const accountEmail = params.accountEmail?.trim() || undefined;
        return await createConversationFromEmail(ctx, {
          organizationId,
          emails: params.emails,
          status: params.status,
          priority: params.priority,
          type: params.type,
          accountEmail,
          integrationName: params.integrationName,
        });
      }

      case 'create_from_sent_email': {
        const accountEmail = params.accountEmail?.trim() || undefined;
        return await createConversationFromSentEmail(ctx, {
          organizationId,
          emails: params.emails,
          status: params.status,
          priority: params.priority,
          accountEmail,
          type: params.type,
          integrationName: params.integrationName,
        });
      }

      default:
        throw new Error(
          `Unsupported conversation operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
