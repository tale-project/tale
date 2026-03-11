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
    documentId: z
      .string()
      .min(1)
      .describe(
        'The Convex document ID (the "id" field from document_list, NOT "fileId"). Use fileId with file extraction tools instead.',
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
  tool: createTool({
    description: `Retrieve document content from the knowledge base by document ID.

USE THIS TOOL TO:
• Read the full or partial content of a specific document
• Paginate through large documents using chunk ranges
• Follow up after document_list to read a document's content

DO NOT USE THIS TOOL FOR:
• Searching across documents — use rag_search instead
• Listing or browsing documents — use document_list instead
• Extracting data from uploaded files — use pdf, docx, txt, excel, image, or pptx tools

RESPONSE FIELDS:
• documentId: The document ID
• name: Document title
• content: The retrieved text content
• chunkRange: { start, end } — actual chunk range returned (1-indexed)
• totalChunks: Total chunks in the document
• truncated: Whether content was truncated to fit the ~50K char limit
• totalChars: Total character count of the requested chunk range (before truncation)

PAGINATION (for large documents):
1. First call: omit chunkStart and chunkEnd to get the first chunks
2. Check totalChunks and chunkRange in the response
3. If you need more, call again with chunkStart set to chunkRange.end + 1
4. Max 100 chunks per call

TIPS:
• Get document IDs from document_list first
• For semantic search across documents, use rag_search instead
• Documents must be indexed (ragInfo.status = "completed") to be retrievable`,
    args: documentRetrieveArgs,
    handler: async (ctx, args): Promise<DocumentRetrieveResult> => {
      return retrieveDocument(ctx, args);
    },
  }),
} as const satisfies ToolDefinition;
