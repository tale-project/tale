/**
 * Convex Tool: Document Retrieve
 *
 * Retrieve full or partial document content from the knowledge base by ID.
 * Supports chunk-based pagination for large documents.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type { DocumentRetrieveResult } from './helpers/retrieve_document';
import { retrieveDocument } from './helpers/retrieve_document';

export const documentRetrieveArgs = z
  .object({
    fileId: z
      .string()
      .min(1)
      .describe(
        'The file ID — either the "fileId" returned by document_find for a knowledge-base document, or the file ID of a chat attachment the user uploaded in this conversation. Always the underlying storage file identifier.',
      ),
    chunkStart: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('First chunk to retrieve (1-indexed). Default: 1.'),
    chunkEnd: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Last chunk to retrieve (1-indexed, inclusive). Omit for all remaining chunks.',
      ),
  })
  .refine(
    (data) => {
      if (data.chunkStart != null && data.chunkEnd != null) {
        return data.chunkStart <= data.chunkEnd;
      }
      return true;
    },
    { message: 'chunkStart must be <= chunkEnd' },
  )
  .refine(
    (data) => {
      if (data.chunkStart != null && data.chunkEnd != null) {
        return data.chunkEnd - data.chunkStart <= 99;
      }
      return true;
    },
    { message: 'Chunk range too large (max 100 chunks per call)' },
  );

export const documentRetrieveTool = {
  name: 'document_retrieve' as const,
  availability: 'any' as const,
  sandboxBridge: true as const,
  tool: createTool({
    description: `Retrieve document content by file ID — knowledge-base documents (fileId from document_find) and chat attachments the user uploaded (ID surfaced alongside the upload); both are indexed and readable here. Returns the text in original order — preferred over the pdf/docx/text extractors when you need the complete document, not just an excerpt.

NOT FOR: searching across documents → rag_search; listing/browsing the knowledge base → document_find; extracting structured data or images → pdf, docx, text, excel, image, or pptx tools.

PAGINATION: the response carries chunkRange {start, end} (1-indexed), totalChunks, and truncated (content capped at ~50K chars). First call: omit chunkStart/chunkEnd. Need more? Call again with chunkStart = chunkRange.end + 1. Max 100 chunks per call.

INDEXING: video/audio transcripts are returned even while search indexing is pending or failed — a "note" field on the result says so; the text is complete, but rag_search may not cover that file yet. For other attachments: "still being indexed" → the chat attachment hasn't finished RAG indexing; wait briefly and retry once before reporting to the user. "RAG indexing failed" → the file cannot be retrieved; tell the user and stop, do not retry.`,
    inputSchema: documentRetrieveArgs,
    execute: async (ctx, args): Promise<DocumentRetrieveResult> => {
      return retrieveDocument(ctx, args);
    },
  }),
} as const satisfies ToolDefinition;
