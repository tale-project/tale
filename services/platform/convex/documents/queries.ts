/**
 * Documents Queries
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { computeUploadUsage } from '../governance/upload_enforcement';
import { getUserTeamIds } from '../lib/get_user_teams';
import { countItemsInOrg } from '../lib/helpers/count_items_in_org';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { isActiveDocument } from './_helpers';
import { canReadDocument, hasKnowledgeHubDocumentAccess } from './access';
import { findDocumentByExternalId } from './find_document_by_external_id';
import { listDocumentVersionsForDoc } from './list_document_versions';
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

/**
 * The caller's upload-quota usage (used / limit bytes) for the org, so the desk
 * can show remaining space BEFORE an upload is rejected — the fix for a full
 * quota reading as a broken uploader. `limited: false` when no per-user volume
 * quota applies; the UI then shows no meter.
 */
export const getUploadUsage = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    limited: v.boolean(),
    usedBytes: v.number(),
    limitBytes: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    const unlimited = { limited: false, usedBytes: 0, limitBytes: null };
    if (!authUser) return unlimited;
    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return unlimited;
    }
    return await computeUploadUsage(ctx, args.organizationId, authUser.userId);
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

const documentVersionValidator = v.object({
  storageId: blobRefValidator,
  createdAt: v.number(),
  isCurrent: v.boolean(),
  fileName: v.optional(v.string()),
  size: v.optional(v.number()),
  contentType: v.optional(v.string()),
});

/**
 * Version history for a document: current blob + prior `historyFiles` with
 * timestamps from `fileMetadata`. Same access contract as `getDocumentById`
 * (org membership + `canReadDocument`, including project-scoped files).
 */
export const listDocumentVersions = query({
  args: {
    documentId: v.id('documents'),
    organizationId: v.string(),
  },
  returns: v.union(
    v.object({
      documentId: v.id('documents'),
      title: v.optional(v.string()),
      versions: v.array(documentVersionValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const doc = await ctx.db.get(args.documentId);
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

    const versions = await listDocumentVersionsForDoc(ctx, doc);
    return {
      documentId: doc._id,
      title: doc.title,
      versions,
    };
  },
});

/**
 * Resolve a document by stable `externalItemId` (e.g. Case Setup
 * `acme:{projectId}:transform.py`) for deep-links into version history.
 * Optional `projectId` scopes the match to that project's files.
 */
export const getDocumentByExternalItemId = query({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  returns: v.union(
    v.object({
      documentId: v.id('documents'),
      title: v.optional(v.string()),
      folderId: v.optional(v.id('folders')),
      hasHistory: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const externalItemId = args.externalItemId.trim();
    if (!externalItemId) return null;

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return null;
    }

    const doc = await findDocumentByExternalId(ctx, {
      organizationId: args.organizationId,
      externalItemId,
    });
    if (
      !doc ||
      !isActiveDocument(doc) ||
      !isActiveOrg(doc.organizationId, args.organizationId)
    ) {
      return null;
    }

    if (args.projectId !== undefined && doc.projectId !== args.projectId) {
      return null;
    }

    const canRead = await canReadDocument(ctx, doc, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });
    if (!canRead) return null;

    return {
      documentId: doc._id,
      title: doc.title,
      folderId: doc.folderId,
      hasHistory: (doc.historyFiles?.length ?? 0) > 0,
    };
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
