/**
 * Knowledge entries queries
 *
 * Org-scoped (V1): every org member can list entries; team scoping is an
 * explicit follow-up. Auth mirrors `documents/queries.ts`
 * (getAuthUserIdentity + getOrganizationMember, failure → empty result).
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import {
  getDocumentRagProjectionBatch,
  type DocumentRagProjection,
} from '../documents/get_document_rag_projection';
import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

export interface KnowledgeEntryItem extends Doc<'knowledgeEntries'> {
  ragStatus?: DocumentRagProjection['status'] | 'not_indexed';
  ragIndexedAt?: number;
  ragError?: string;
  ragErrorCode?: string;
}

async function projectEntries(
  ctx: Parameters<typeof getDocumentRagProjectionBatch>[0],
  entries: Doc<'knowledgeEntries'>[],
): Promise<KnowledgeEntryItem[]> {
  const docIds = new Map<string, Doc<'documents'>>();
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.documentId) return;
      const doc = await ctx.db.get(entry.documentId);
      if (doc) docIds.set(String(entry._id), doc);
    }),
  );

  const ragByDocId = await getDocumentRagProjectionBatch(ctx, [
    ...docIds.values(),
  ]);

  return entries.map((entry) => {
    const doc = docIds.get(String(entry._id));
    const rag = doc ? ragByDocId.get(String(doc._id)) : undefined;
    return {
      ...entry,
      ragStatus: rag?.status ?? 'not_indexed',
      ragIndexedAt: rag?.indexedAt,
      ragError: rag?.error,
      ragErrorCode: rag?.errorCode,
    };
  });
}

export const approxCountKnowledgeEntries = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return 0;
    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return 0;
    }
    return await countItemsInOrg(
      ctx.db,
      'knowledgeEntries',
      args.organizationId,
    );
  },
});

export const listKnowledgeEntriesPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.union(v.literal('active'), v.literal('superseded'))),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const status = args.status ?? 'active';
    const result = await ctx.db
      .query('knowledgeEntries')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', status),
      )
      .order('desc')
      .paginate(args.paginationOpts);

    const live = result.page.filter((e) => e.deletedAt === undefined);
    return {
      ...result,
      page: await projectEntries(ctx, live),
    };
  },
});

/**
 * One entry plus its full version chain (active head first, then superseded
 * versions newest-first). Returns null on not-found or any access failure.
 */
export const getKnowledgeEntryVersions = query({
  args: {
    entryId: v.id('knowledgeEntries'),
    organizationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    entry: KnowledgeEntryItem;
    versions: Doc<'knowledgeEntries'>[];
  } | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const entry = await ctx.db.get(args.entryId);
    // Active-org coherence: deny an entry carried over from another org.
    if (
      !entry ||
      entry.deletedAt !== undefined ||
      !isActiveOrg(entry.organizationId, args.organizationId)
    ) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, entry.organizationId, authUser);
    } catch {
      return null;
    }

    const versions: Doc<'knowledgeEntries'>[] = [];
    for await (const row of ctx.db
      .query('knowledgeEntries')
      .withIndex('by_org_topicKey_status', (q) =>
        q
          .eq('organizationId', entry.organizationId)
          .eq('topicKey', entry.topicKey)
          .eq('status', 'superseded'),
      )) {
      if (row.deletedAt !== undefined) continue;
      versions.push(row);
    }
    versions.sort((a, b) => b.createdAt - a.createdAt);

    const [projected] = await projectEntries(ctx, [entry]);
    return { entry: projected, versions };
  },
});
