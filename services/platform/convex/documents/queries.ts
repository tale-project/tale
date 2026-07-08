/**
 * Documents Queries
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { isActiveDocument } from './_helpers';
import { canReadDocument, hasKnowledgeHubDocumentAccess } from './access';
import { listDocumentsPaginated as listDocumentsPaginatedHelper } from './list_documents_paginated';
import { searchDocumentsForMention as searchDocumentsForMentionHelper } from './search_documents_for_mention';
import { transformDocumentsBatch } from './transform_to_document_item';

export const approxCountDocuments = query({
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
      if (!isActiveDocument(doc)) continue;
      if (!hasKnowledgeHubDocumentAccess(doc, userTeamIds)) continue;

      documents.push(doc);
    }

    return await transformDocumentsBatch(ctx, documents);
  },
});

/**
 * Point-query a single document by id (org membership + active lifecycle +
 * scope access). Unlike `listDocuments` — which is a Knowledge Hub surface
 * and never shows project files — this by-ID read also admits a
 * project-scoped document when the caller has access to the owning project
 * (`canReadDocument`). Returns null on not-found or any access failure
 * (never leaks a document from another org/team/project).
 */
export const getDocumentById = query({
  args: {
    documentId: v.id('documents'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const doc = await ctx.db.get(args.documentId);
    // Active-org coherence: deny a document carried over from another org.
    if (
      !doc ||
      !isActiveDocument(doc) ||
      !isActiveOrg(doc.organizationId, args.organizationId)
    ) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, doc.organizationId, authUser);
    } catch {
      return null;
    }

    const canRead = await canReadDocument(ctx, doc, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });
    if (!canRead) return null;

    const [item] = await transformDocumentsBatch(ctx, [doc]);
    return item ?? null;
  },
});

/**
 * Title search for the chat composer's `@` knowledge-base mention picker.
 * Returns slim rows for RAG-indexed, user-accessible documents only (the
 * picker must not offer a document that the pinned-turn retrieval could not
 * actually search). Same auth contract as `listDocumentsPaginated`. In a
 * project thread the project's own files join the results (project read
 * access re-verified here — an inaccessible or foreign project silently
 * contributes nothing, mirroring `searchFoldersForMention`).
 */
export const searchDocumentsForMention = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return [];
    }

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    let projectId = args.projectId;
    if (projectId) {
      const access = await resolveProjectAccessForUser(ctx, projectId, {
        userId: authUser.userId,
        organizationId: args.organizationId,
      });
      if (!access.canRead) projectId = undefined;
    }

    return await searchDocumentsForMentionHelper(ctx, {
      organizationId: args.organizationId,
      term: args.query,
      userTeamIds,
      projectId,
    });
  },
});

export const listDocumentsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    folderId: v.optional(v.id('folders')),
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
