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
  tool: createTool({
    description: `Retrieve document content by file ID. Works for both knowledge-base documents (found via document_find) and files the user uploaded directly in this chat — both are indexed and readable through this tool.

USE THIS TOOL TO:
• Read the full or partial content of a specific document
• Paginate through large documents using chunk ranges
• Follow up after document_find to read a knowledge-base document's content
• Read the full text of a chat attachment in original order (preferred over pdf/docx/text extractors when you need the complete document, not just an excerpt)

DO NOT USE THIS TOOL FOR:
• Searching across documents — use rag_search instead
• Listing or browsing knowledge-base documents — use document_find instead
• Extracting structured data or images from a file — use pdf, docx, text, excel, image, or pptx tools

RESPONSE FIELDS:
• fileId: The file ID
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

INDEXING STATE:
• If the tool errors with "still being indexed", the chat attachment hasn't finished RAG indexing yet — wait briefly and retry once before reporting to the user
• If the tool errors with "RAG indexing failed", the file cannot be retrieved; tell the user and stop, do not retry

TIPS:
• Get file IDs from document_find (knowledge base) or the user's chat attachment (the ID surfaced alongside the upload)
• For semantic search across documents, use rag_search instead`,
    inputSchema: documentRetrieveArgs,
    execute: async (ctx, args): Promise<DocumentRetrieveResult> => {
      return retrieveDocument(ctx, args);
    },
  }),
} as const satisfies ToolDefinition;
