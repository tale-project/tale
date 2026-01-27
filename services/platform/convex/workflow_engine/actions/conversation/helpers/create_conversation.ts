import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ConversationStatus, ConversationPriority } from './types';
import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';

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

export async function createConversation(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    customerId?: Id<'customers'>;
    subject?: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    providerId?: Id<'emailProviders'>;
    metadata?: Record<string, unknown>;
    draftMessage?: DraftMessage;
  },
) {
  // When draftMessage is provided, direction is always 'outbound'
  const direction = params.draftMessage ? 'outbound' : params.direction;

  const result: { success: boolean; conversationId: string } =
    await ctx.runMutation(internal.conversations.mutations.createConversation, {
      organizationId: params.organizationId,
      customerId: params.customerId,
      subject: params.subject,
      status: params.status,
      priority: params.priority,
      type: params.type,
      channel: params.channel,
      direction,
      providerId: params.providerId,
      metadata: params.metadata as ConvexJsonRecord | undefined,
    });

  // Fetch and return the full created entity
  const createdConversation = await ctx.runQuery(
    internal.conversations.queries.getConversationById,
    { conversationId: result.conversationId as Id<'conversations'> },
  );

  if (!createdConversation) {
    throw new Error(
      `Failed to fetch created conversation with ID "${result.conversationId}" after creation`,
    );
  }

  // Create pending approval if draftMessage is provided
  let approvalId: string | undefined;
  if (params.draftMessage) {
    const {
      priority,
      description,
      dueDate,
      content,
      subject,
      recipients,
      ccRecipients,
      bccRecipients,
      metadata,
    } = params.draftMessage;

    const approvalMetadata: Record<string, unknown> = {
      ...metadata,
      content,
      subject,
      recipients,
      ...(ccRecipients && { ccRecipients }),
      ...(bccRecipients && { bccRecipients }),
      createdAt: Date.now(),
    };

    approvalId = await ctx.runMutation(
      internal.approvals.mutations.createApproval,
      {
        organizationId: params.organizationId,
        resourceType: 'conversations',
        resourceId: result.conversationId,
        priority,
        description,
        dueDate,
        metadata: approvalMetadata as ConvexJsonRecord,
      },
    );
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return {
    ...createdConversation,
    ...(approvalId ? { approvalId } : {}),
  };
}
