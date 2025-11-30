/**
 * Update conversations with flexible filtering and updates (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type {
  UpdateConversationsArgs,
  UpdateConversationsResult,
} from './types';
import type { Doc, Id } from '../../_generated/dataModel';
import { set, merge } from 'lodash';

export async function updateConversations(
  ctx: MutationCtx,
  args: UpdateConversationsArgs,
): Promise<UpdateConversationsResult> {
  // Validate: must provide either conversationId or organizationId
  if (!args.conversationId && !args.organizationId) {
    throw new Error(
      'Must provide either conversationId or organizationId for safety',
    );
  }

  // Find conversations to update
  let conversationsToUpdate: Array<Doc<'conversations'>> = [];

  if (args.conversationId) {
    // Update by ID (most common case)
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${args.conversationId}`);
    }
    conversationsToUpdate = [conversation];
  } else if (args.organizationId) {
    // Update by filters (batch update)
    const conversations = await ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId!),
      )
      .collect();

    // Filter by other criteria
    conversationsToUpdate = conversations.filter((conversation) => {
      if (args.status && conversation.status !== args.status) {
        return false;
      }
      if (args.priority && conversation.priority !== args.priority) {
        return false;
      }

      return true;
    });
  }

  // Apply updates to each conversation
  const updatedIds: Array<Id<'conversations'>> = [];

  for (const conversation of conversationsToUpdate) {
    // Build the patch object
    const patch: Record<string, unknown> = {};

    // Copy direct field updates from args.updates
    const updates = args.updates as Record<string, unknown>;
    if (updates.customerId !== undefined) patch.customerId = updates.customerId;
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.type !== undefined) patch.type = updates.type;

    // Handle metadata updates with lodash
    if (updates.metadata) {
      const existingMetadata =
        (conversation.metadata as Record<string, unknown>) ?? {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      for (const [key, value] of Object.entries(
        updates.metadata as Record<string, unknown>,
      )) {
        if (key.includes('.')) {
          // Use lodash.set for dot-notation keys
          set(updatedMetadata, key, value);
        } else {
          // For top-level keys, use merge for objects
          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            typeof updatedMetadata[key] === 'object' &&
            updatedMetadata[key] !== null &&
            !Array.isArray(updatedMetadata[key])
          ) {
            updatedMetadata[key] = merge(
              {},
              updatedMetadata[key] as Record<string, unknown>,
              value as Record<string, unknown>,
            );
          } else {
            updatedMetadata[key] = value;
          }
        }
      }

      patch.metadata = updatedMetadata;
    }

    // Apply the patch
    await ctx.db.patch(conversation._id, patch);
    updatedIds.push(conversation._id);
  }

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds: updatedIds,
  };
}
