/**
 * Update conversations with flexible filtering and updates (business logic)
 */

import { set, merge } from 'lodash';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type {
  UpdateConversationsArgs,
  UpdateConversationsResult,
} from './types';

import * as AuditLogHelpers from '../audit_logs/helpers';

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
    const orgId = args.organizationId;
    // Update by filters (batch update) using async iteration
    for await (const conversation of ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', orgId))) {
      // Filter by other criteria
      if (args.status && conversation.status !== args.status) {
        continue;
      }
      if (args.priority && conversation.priority !== args.priority) {
        continue;
      }
      conversationsToUpdate.push(conversation);
    }
  }

  // Build patches for each conversation
  const { updates } = args;
  const patches: Array<{
    id: Id<'conversations'>;
    patch: Record<string, unknown>;
  }> = conversationsToUpdate.map((conversation) => {
    const patch: Record<string, unknown> = {};

    // Copy direct field updates from args.updates (now properly typed)
    if (updates.customerId !== undefined) patch.customerId = updates.customerId;
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.type !== undefined) patch.type = updates.type;

    // Handle metadata updates with lodash
    if (updates.metadata) {
      const existingMetadata = conversation.metadata ?? {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      for (const [key, value] of Object.entries(updates.metadata)) {
        if (key.includes('.')) {
          // Use lodash.set for dot-notation keys
          set(updatedMetadata, key, value);
        } else {
          // For top-level keys, use merge for objects
          const existingValue = updatedMetadata[key];
          const isValueObject =
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value);
          const isExistingObject =
            typeof existingValue === 'object' &&
            existingValue !== null &&
            !Array.isArray(existingValue);

          if (isValueObject && isExistingObject) {
            updatedMetadata[key] = merge({}, existingValue, value);
          } else {
            updatedMetadata[key] = value;
          }
        }
      }

      patch.metadata = updatedMetadata;
    }

    return { id: conversation._id, patch };
  });

  // Apply all patches in parallel
  await Promise.all(patches.map(({ id, patch }) => ctx.db.patch(id, patch)));

  const updatedIds = patches.map(({ id }) => id);

  if (updatedIds.length > 0) {
    const organizationId =
      args.organizationId || conversationsToUpdate[0]?.organizationId;
    if (organizationId) {
      await AuditLogHelpers.logSuccess(
        ctx,
        {
          organizationId,
          actor: { id: 'system', type: 'system' as const },
        },
        'update_conversations',
        'data',
        'conversation',
        undefined,
        undefined,
        undefined,
        undefined,
        {
          conversationIds: updatedIds.map(String),
          count: updatedIds.length,
          updates: args.updates,
        },
      );
    }
  }

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
