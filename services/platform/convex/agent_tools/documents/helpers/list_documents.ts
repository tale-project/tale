import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import type { AgentDocumentListResult as DocumentListResult } from '../../../documents/list_documents_for_agent';
import type { documentListArgs } from '../document_list_tool';

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

  const dateFrom = args.dateFrom ? toTimestamp(args.dateFrom) : undefined;
  // End-of-day (23:59:59.999) so documents created during that day are included
  const dateTo = args.dateTo
    ? toTimestamp(args.dateTo) + 86_400_000 - 1
    : undefined;

  if (dateFrom != null && dateTo != null && dateFrom > dateTo) {
    return {
      documents: [],
      totalCount: 0,
      hasMore: false,
      cursor: null,
      warning: 'dateFrom is after dateTo. Check your date range.',
    };
  }

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

function toTimestamp(dateStr: string): number {
  const parsed = new Date(dateStr);
  const ts = parsed.getTime();
  if (!Number.isFinite(ts)) {
    throw new Error(
      `Invalid date: "${dateStr}". Must be a valid YYYY-MM-DD date.`,
    );
  }
  if (parsed.toISOString().slice(0, 10) !== dateStr) {
    throw new Error(
      `Invalid date: "${dateStr}" resolved to "${parsed.toISOString().slice(0, 10)}". Check the date value.`,
    );
  }
  return ts;
}
