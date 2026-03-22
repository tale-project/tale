import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import type { documentRetrieveArgs } from '../document_retrieve_tool';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { getRagConfig } from '../../../lib/helpers/rag_config';
import {
  fetchDocumentContent,
  type DocumentContentResult,
} from './fetch_document_content';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export type RetrieveDocumentArgs = z.infer<typeof documentRetrieveArgs>;

export type DocumentRetrieveResult = DocumentContentResult;

export async function retrieveDocument(
  ctx: ToolCtx,
  args: RetrieveDocumentArgs,
): Promise<DocumentRetrieveResult> {
  const { organizationId, userId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for retrieving documents',
    );
  }
  if (!userId) {
    throw new Error('userId is required in context for retrieving documents');
  }

  debugLog('tool:document_retrieve start', {
    fileId: args.fileId,
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  // Resolve fileId → document record for access control
  const document = await ctx.runQuery(
    internal.documents.internal_queries.findDocumentByFileId,
    { organizationId, fileId: args.fileId },
  );

  if (!document) {
    throw new Error(
      `Document not found: "${args.fileId}". ` +
        'No document exists with this file ID in the current organization.',
    );
  }

  const accessibleIds: string[] = await ctx.runQuery(
    internal.documents.internal_queries.getAccessibleDocumentIds,
    { organizationId, userId },
  );

  if (!accessibleIds.includes(document._id)) {
    throw new Error(
      `Access denied for document "${args.fileId}". ` +
        "You may not have access to this document's team.",
    );
  }

  const ragServiceUrl = getRagConfig().serviceUrl;

  const result = await fetchDocumentContent(ragServiceUrl, args.fileId, {
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  debugLog('tool:document_retrieve success', {
    fileId: args.fileId,
    totalChunks: result.totalChunks,
    totalChars: result.totalChars,
    truncated: result.truncated,
  });

  return result;
}
