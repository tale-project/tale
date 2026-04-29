import { v } from 'convex/values';

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
