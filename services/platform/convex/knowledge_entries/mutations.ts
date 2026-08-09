/**
 * Knowledge entries mutations (manual management UI)
 *
 * Org-scoped (V1). Every mutation requires org membership and consumes the
 * org-keyed `knowledge:mutate` rate limit. Content lives on the entry row;
 * the markdown backing document + RAG indexing are materialized
 * asynchronously by `materializeKnowledgeEntry`.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import { assertRecordTrashable } from '../documents/access';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  findActiveEntryByTopicKey,
  markEntryChainDeleted,
  upsertEntryRow,
  validateTopicAndContent,
} from './helpers';

export const createKnowledgeEntry = mutation({
  args: {
    organizationId: v.string(),
    topic: v.string(),
    content: v.string(),
  },
  returns: v.id('knowledgeEntries'),
  handler: async (ctx, args): Promise<Id<'knowledgeEntries'>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    await getOrganizationMember(ctx, args.organizationId, authUser);
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      args.organizationId,
    );

    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );

    const existing = await findActiveEntryByTopicKey(
      ctx,
      args.organizationId,
      topicKey,
    );
    if (existing) {
      // Structured code so the client can surface the duplicate toast in prod.
      // A raw `Error` message is redacted to "Server Error" by Convex in prod,
      // which kills the client's duplicate detection.
      throw new ConvexError({
        code: 'KNOWLEDGE_ENTRY_DUPLICATE',
        topic: existing.topic,
      });
    }

    const { entryId } = await upsertEntryRow(ctx, {
      organizationId: args.organizationId,
      topic,
      topicKey,
      content,
      source: 'manual',
      createdBy: authUser.userId,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.knowledge_entries.internal_actions.materializeKnowledgeEntry,
      { entryId },
    );

    return entryId;
  },
});

export const updateKnowledgeEntry = mutation({
  args: {
    entryId: v.id('knowledgeEntries'),
    topic: v.string(),
    content: v.string(),
  },
  returns: v.id('knowledgeEntries'),
  handler: async (ctx, args): Promise<Id<'knowledgeEntries'>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.deletedAt !== undefined) {
      throw new ConvexError({ code: 'KNOWLEDGE_ENTRY_NOT_FOUND' });
    }
    if (entry.status !== 'active') {
      throw new ConvexError({ code: 'KNOWLEDGE_ENTRY_NOT_ACTIVE' });
    }

    await getOrganizationMember(ctx, entry.organizationId, authUser);
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      entry.organizationId,
    );

    const { topic, topicKey, content } = validateTopicAndContent(
      args.topic,
      args.content,
    );

    // Topic rename must not collide with another live topic.
    if (topicKey !== entry.topicKey) {
      const collision = await findActiveEntryByTopicKey(
        ctx,
        entry.organizationId,
        topicKey,
      );
      if (collision) {
        throw new ConvexError({
          code: 'KNOWLEDGE_ENTRY_DUPLICATE',
          topic: collision.topic,
        });
      }
    }

    const now = Date.now();
    const newEntryId = await ctx.db.insert('knowledgeEntries', {
      organizationId: entry.organizationId,
      topic,
      topicKey,
      content,
      status: 'active',
      documentId: entry.documentId,
      source: 'manual',
      createdBy: authUser.userId,
      createdAt: now,
    });
    await ctx.db.patch(entry._id, {
      status: 'superseded',
      supersededBy: newEntryId,
      supersededAt: now,
    });

    // On rename, re-key the whole superseded chain so version history
    // follows the entry to its new topic key.
    if (topicKey !== entry.topicKey) {
      for await (const row of ctx.db
        .query('knowledgeEntries')
        .withIndex('by_org_topicKey_status', (q) =>
          q
            .eq('organizationId', entry.organizationId)
            .eq('topicKey', entry.topicKey),
        )) {
        if (row._id === newEntryId) continue;
        await ctx.db.patch(row._id, { topicKey });
      }
    }

    await ctx.scheduler.runAfter(
      0,
      internal.knowledge_entries.internal_actions.materializeKnowledgeEntry,
      { entryId: newEntryId },
    );

    return newEntryId;
  },
});

export const deleteKnowledgeEntry = mutation({
  args: {
    entryId: v.id('knowledgeEntries'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.deletedAt !== undefined) {
      throw new ConvexError({ code: 'KNOWLEDGE_ENTRY_NOT_FOUND' });
    }

    await getOrganizationMember(ctx, entry.organizationId, authUser);
    await checkOrganizationRateLimit(
      ctx,
      'knowledge:mutate',
      entry.organizationId,
    );

    // Controlled-record gate BEFORE any write: the scheduled delete pipeline
    // (`deleteDocumentFromRag` → `deleteDocumentById` without `callerOrgId`)
    // never runs `assertRecordTrashable`, so an in_review/approved backing
    // record must refuse the whole entry delete synchronously here.
    if (entry.documentId) {
      const backingDoc = await ctx.db.get(entry.documentId);
      if (backingDoc) assertRecordTrashable(backingDoc);
    }

    await markEntryChainDeleted(ctx, entry.organizationId, entry.topicKey);

    // Remove the backing document (Convex row + RAG chunks + blob cleanup
    // ride the existing document deletion pipeline).
    if (entry.documentId) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.internal_actions.deleteDocumentFromRag,
        { documentId: entry.documentId },
      );
    }

    return null;
  },
});
