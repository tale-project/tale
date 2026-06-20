/**
 * Update conversations with flexible filtering and updates (business logic)
 */

import { set, merge } from 'lodash';

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import type {
  UpdateConversationsArgs,
  UpdateConversationsResult,
} from './types';

/**
 * Apply a partial metadata update onto an existing metadata record. Dot-notation
 * keys (`a.b.c`) are written via `lodash.set`; for top-level keys, two plain
 * objects are deep-merged while any other value (primitive / array / null)
 * replaces. Returns a fresh object — the inputs are never mutated.
 */
function mergeMetadataUpdates(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      set(merged, key, value);
      continue;
    }
    const current = merged[key];
    merged[key] =
      isRecord(value) && isRecord(current) ? merge({}, current, value) : value;
  }
  return merged;
}

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
    // Cross-tenant write guard: when the caller's org is known (the agent
    // conversation_write tool always passes it), the target conversation must
    // belong to it — mirrors addMessageToConversation. Closes the IDOR.
    if (
      args.organizationId &&
      conversation.organizationId !== args.organizationId
    ) {
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

    if (updates.metadata) {
      patch.metadata = mergeMetadataUpdates(
        conversation.metadata ?? {},
        updates.metadata,
      );
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
      await AuditLogHelpers.logSuccess(ctx, {
        auditCtx: {
          organizationId,
          actor: { id: 'system', type: 'system' as const },
        },
        action: 'update_conversations',
        category: 'data',
        resourceType: 'conversation',
        metadata: {
          conversationIds: updatedIds.map(String),
          count: updatedIds.length,
          updates: args.updates,
        },
      });
    }
  }

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
