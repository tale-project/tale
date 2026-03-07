import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import type { documentListArgs } from '../document_list_tool';
import type { DocumentListResult } from './types';

import { internal } from '../../../_generated/api';

export type ListDocumentsArgs = z.infer<typeof documentListArgs>;

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

  const dateFrom = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  // End-of-day (23:59:59.999) so documents created during that day are included
  const dateTo = args.dateTo
    ? new Date(args.dateTo).getTime() + 86_400_000 - 1
    : undefined;

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
    limit: args.limit,
    cursor: args.cursor,
  });
}
