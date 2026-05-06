import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkMembership } from './check_membership';
import { getAccessibleDocumentIds as getAccessibleDocumentIdsHelper } from './get_accessible_document_ids';
import { getAgentScopedFileIds as getAgentScopedFileIdsHelper } from './get_agent_scoped_file_ids';
import * as DocumentsHelpers from './helpers';
import { listDocumentsForAgent as listDocumentsForAgentHelper } from './list_documents_for_agent';
import { listIndexedDocumentsForAgent as listIndexedDocumentsForAgentHelper } from './list_indexed_documents_for_agent';
import { sourceProviderValidator } from './validators';

export const getDocumentByIdRaw = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.getDocumentById(ctx, args.documentId);
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
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
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
    const { userId, ...rest } = args;
    const userTeamIds = await getUserTeamIds(ctx, userId);
    return listDocumentsForAgentHelper(ctx, { ...rest, userTeamIds });
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
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return listIndexedDocumentsForAgentHelper(ctx, args);
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
  },
  handler: async (ctx, args) => {
    return await getAgentScopedFileIdsHelper(ctx, args);
  },
});
