import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import type { documentRetrieveArgs } from '../document_retrieve_tool';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { getRagConfig } from '../../../lib/helpers/rag_config';
import { toId } from '../../../lib/type_cast_helpers';
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
    documentId: args.documentId,
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  const accessibleIds: string[] = await ctx.runQuery(
    internal.documents.internal_queries.getAccessibleDocumentIds,
    { organizationId, userId },
  );

  if (!accessibleIds.includes(args.documentId)) {
    throw new Error(
      `Document not found or access denied: "${args.documentId}". ` +
        'The document may not exist, may not be indexed yet, or you may not have access.',
    );
  }

  // Look up document to get its file storage ID for RAG content retrieval
  const document = await ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    { documentId: toId<'documents'>(args.documentId) },
  );
  if (!document?.fileId) {
    throw new Error(
      `Document "${args.documentId}" has no file associated with it.`,
    );
  }

  const ragServiceUrl = getRagConfig().serviceUrl;

  const result = await fetchDocumentContent(ragServiceUrl, document.fileId, {
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  debugLog('tool:document_retrieve success', {
    documentId: args.documentId,
    totalChunks: result.totalChunks,
    totalChars: result.totalChars,
    truncated: result.truncated,
  });

  return result;
}
