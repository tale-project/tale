import type { ToolCtx } from '@convex-dev/agent';

import type { DocumentListResult } from './types';

import { internal } from '../../../_generated/api';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface ListDocumentsArgs {
  folderPath?: string;
  extension?: string;
  teamId?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: number;
}

export async function listDocuments(
  ctx: ToolCtx,
  args: ListDocumentsArgs,
): Promise<DocumentListResult> {
  const { organizationId, userId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing documents',
    );
  }
  if (!userId) {
    throw new Error('userId is required in context for listing documents');
  }

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const dateFrom = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const dateTo = args.dateTo ? new Date(args.dateTo).getTime() : undefined;

  return ctx.runQuery(internal.documents.internal_queries.listForAgent, {
    organizationId,
    userId,
    folderPath: args.folderPath,
    extension: args.extension,
    teamId: args.teamId,
    dateFrom,
    dateTo,
    query: args.query,
    sortBy: args.sortBy,
    sortOrder: args.sortOrder,
    limit,
    cursor: args.cursor,
  });
}
