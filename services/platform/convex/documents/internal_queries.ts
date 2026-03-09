import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAccessibleDocumentIds as getAccessibleDocumentIdsHelper } from './get_accessible_document_ids';
import * as DocumentsHelpers from './helpers';
import { listDocumentsForAgent as listDocumentsForAgentHelper } from './list_documents_for_agent';
import { sourceProviderValidator } from './validators';

export const getDocumentByIdRaw = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.getDocumentById(ctx, args.documentId);
  },
});

export const listDocumentsByExtension = internalQuery({
  args: {
    organizationId: v.string(),
    extension: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.listDocumentsByExtension(ctx, args);
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
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
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
    query: v.optional(v.string()),
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
