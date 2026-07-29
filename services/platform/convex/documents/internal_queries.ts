import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { toId } from '../lib/type_cast_helpers';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { checkMembership } from './check_membership';
import { getAccessibleDocumentIds as getAccessibleDocumentIdsHelper } from './get_accessible_document_ids';
import { getAgentScopedFileIds as getAgentScopedFileIdsHelper } from './get_agent_scoped_file_ids';
import * as DocumentsHelpers from './helpers';
import { listDocumentsForAgent as listDocumentsForAgentHelper } from './list_documents_for_agent';
import { listFilesByFolder } from './list_files_by_folder';
import { listIndexedDocumentsForAgent as listIndexedDocumentsForAgentHelper } from './list_indexed_documents_for_agent';
import { listOrphanedExternalDocs as listOrphanedExternalDocsHelper } from './list_orphaned_external_docs';
import { sourceProviderValidator } from './validators';

export const getDocumentByIdRaw = internalQuery({
  args: {
    documentId: v.id('documents'),
    /**
     * Caller's organizationId — closes the cross-tenant read IDOR on
     * REST `GET /api/v1/documents/:id`. Optional for in-process
     * callers (workflow / agent flows that already operate within the
     * caller's org); REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await DocumentsHelpers.getDocumentById(ctx, args.documentId);
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
  },
});

export const queryDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.optional(sourceProviderValidator),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.queryDocuments(ctx, args);
  },
});

export const findDocumentByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
    // When provided, scopes the lookup to a specific target folder (`null`
    // means the root). Omit to match across all folders (legacy behavior).
    folderId: v.optional(v.union(v.id('folders'), v.null())),
    // When provided, scopes the lookup to docs whose `folderPath` equals the
    // prefix or sits under it. Used by sync workflows to keep the cross-folder
    // fallback confined to a single sync's target subtree.
    folderPathPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
  },
});

/**
 * Every document sharing one external item id — used by the single-file sync
 * reconcile to collapse duplicate rows down to the one canonical doc.
 */
export const findDocumentsByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentsByExternalId(ctx, args);
  },
});

export const findDocumentByFileId = internalQuery({
  args: {
    organizationId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByFileId(ctx, args);
  },
});

export const listForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    folderId: v.optional(v.string()),
    /** Owning project of a project-scoped listing (e.g. a task's quarter
     *  folder). Read access is resolved once here; only then does the helper
     *  surface that project's docs (hub listings still exclude them). */
    projectId: v.optional(v.string()),
    folderPath: v.optional(v.string()),
    extension: v.optional(v.string()),
    teamId: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    fileName: v.optional(v.string()),
    sortBy: v.optional(v.union(v.literal('createdAt'), v.literal('name'))),
    sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, projectId, ...rest } = args;
    const userTeamIds = await getUserTeamIds(ctx, userId);
    // A project-scoped listing surfaces the project's own docs only after the
    // caller proves read access to it. Denied / absent → fall through to hub
    // rules (project docs stay excluded) — fail-safe, no boundary loosening.
    let allowedProjectId: string | undefined;
    if (projectId) {
      const access = await resolveProjectAccessForUser(
        ctx,
        toId<'projects'>(projectId),
        { userId, organizationId: args.organizationId },
      );
      if (access.canRead) allowedProjectId = projectId;
    }
    return listDocumentsForAgentHelper(ctx, {
      ...rest,
      userTeamIds,
      projectId: allowedProjectId,
    });
  },
});

export const getAccessibleDocumentIds = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getAccessibleDocumentIdsHelper(ctx, args);
  },
});

export const verifyOrganizationMembership = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await checkMembership(ctx, args);
    return member !== null;
  },
});

/**
 * Confirm every storage id belongs to a fileMetadata row in the given
 * org. Used by `compareDocuments` (and any other action that takes
 * client-supplied `_storage` ids) to prevent cross-org reads — Convex
 * `_storage` is a global namespace, so a member of org A can supply
 * org B's storage id and read its blob unless we cross-check
 * fileMetadata.organizationId here.
 */
export const verifyStorageIdsBelongToOrg = internalQuery({
  args: {
    organizationId: v.string(),
    // Accept plain strings since callers (e.g. compareDocuments) take
    // storage ids as v.string() over the wire and we'd otherwise need
    // them to import @convex-dev/id_branding to call this.
    storageIds: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for (const storageId of args.storageIds) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id is a wire string; the by_storageId index lookup expects the branded Id<'_storage'>
      const branded = storageId as unknown as Id<'_storage'>;
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', branded))
        .first();
      if (!meta || meta.organizationId !== args.organizationId) {
        return false;
      }
    }
    return true;
  },
});

export const listIndexedForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    agentTeamId: v.optional(v.string()),
    agentTeamIds: v.optional(v.array(v.string())),
    includeTeamKnowledge: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeFileIds: v.optional(v.array(v.string())),
    agentProjectIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return listIndexedDocumentsForAgentHelper(ctx, args);
  },
});

export const listOrphanedExternalDocs = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.string(),
    folderPathPrefix: v.string(),
    presentExternalIds: v.array(v.string()),
    driveId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listOrphanedExternalDocsHelper(ctx, args);
  },
});

export const getAgentScopedFileIds = internalQuery({
  args: {
    organizationId: v.string(),
    agentTeamId: v.optional(v.string()),
    agentTeamIds: v.optional(v.array(v.string())),
    includeTeamKnowledge: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeFileIds: v.optional(v.array(v.string())),
    /**
     * Projects feature: union the project's RAG-indexed files into
     * the agent's file ID set. See `get_agent_scoped_file_ids.ts`.
     */
    agentProjectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await getAgentScopedFileIdsHelper(ctx, args);
  },
});

/**
 * Files DIRECTLY inside one folder — see {@link listFilesByFolder}. Auth-free
 * by design: the caller is the workflow sandbox-staging action, which acts
 * with workflow authority (the org boundary is still enforced via
 * `organizationId` on the index / path lookup).
 */
export const listFilesByFolderInternal = internalQuery({
  args: {
    organizationId: v.string(),
    folderId: v.optional(v.id('folders')),
    folderPath: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        fileId: blobRefValidator,
        name: v.string(),
      }),
    ),
  ),
  handler: async (ctx, args) => {
    return await listFilesByFolder(ctx, args);
  },
});

/**
 * A document living DIRECTLY in one folder under a given file name — the
 * workflow `document.create` dedupe probe. Titles are stored with or without
 * their extension depending on the writing lane, so the exact name is tried
 * first and the extension-stripped title second.
 */
export const findDocumentInFolderByTitle = internalQuery({
  args: {
    organizationId: v.string(),
    folderId: v.id('folders'),
    name: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      documentId: v.id('documents'),
      externalItemId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const stripped = args.name.replace(/\.[A-Za-z0-9]+$/, '');
    for (const title of [args.name, stripped]) {
      if (title === '') continue;
      const row = await ctx.db
        .query('documents')
        .withIndex('by_org_title_folder', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('title', title)
            .eq('folderId', args.folderId),
        )
        .first();
      if (
        row &&
        (row.lifecycleStatus === undefined || row.lifecycleStatus === 'active')
      ) {
        return {
          documentId: row._id,
          ...(row.externalItemId !== undefined
            ? { externalItemId: row.externalItemId }
            : {}),
        };
      }
    }
    return null;
  },
});
