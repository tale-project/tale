import { v } from 'convex/values';

import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams } from './helpers/types';

import { deleteDocumentById } from './helpers/delete_document';
import { getRagConfig } from './helpers/get_rag_config';
import { uploadDocument } from './helpers/upload_document';

export const ragAction: ActionDefinition<RagActionParams> = {
  type: 'rag',
  title: 'RAG Document Manager',
  description:
    'Upload or delete documents in RAG service for semantic search and retrieval',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('upload_document'),
      recordId: v.string(),
      sync: v.optional(v.boolean()),
    }),
    v.object({
      operation: v.literal('delete_document'),
      recordId: v.string(),
    }),
  ),

  async execute(ctx, params) {
    const startTime = Date.now();
    const { serviceUrl } = getRagConfig();

    switch (params.operation) {
      case 'upload_document': {
        const result = await uploadDocument(ctx, serviceUrl, params.recordId, {
          sync: params.sync,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'delete_document': {
        const result = await deleteDocumentById({
          ragServiceUrl: serviceUrl,
          documentId: params.recordId,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
    }
  },
};
