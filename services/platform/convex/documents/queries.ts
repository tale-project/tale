/**
 * Documents Queries
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { query } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';
import { listDocumentsPaginated as listDocumentsPaginatedHelper } from './list_documents_paginated';
import { transformDocumentsBatch } from './transform_to_document_item';

export const approxCountDocuments = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await countItemsInOrg(ctx.db, 'documents', args.organizationId);
  },
});

export const listDocuments = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return [];
    }

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    const documents: Doc<'documents'>[] = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      // Team-based access control
      if (doc.teamId !== undefined) {
        if (!hasTeamAccess(doc, userTeamIds)) continue;
      } else if (doc.teamTags && doc.teamTags.length > 0) {
        if (!doc.teamTags.some((tag) => userTeamIds.includes(tag))) continue;
      }

      documents.push(doc);
    }

    return await transformDocumentsBatch(ctx, documents);
  },
});

export const listDocumentsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    sourceProvider: v.optional(v.string()),
    extension: v.optional(v.string()),
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

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    return await listDocumentsPaginatedHelper(ctx, {
      ...args,
      userTeamIds,
    });
  },
});
