/**
 * Convex Tool: Document Find
 *
 * Find and filter documents from the knowledge base.
 * Supports filtering by folder, extension, team, date range, and file name search.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { AgentDocumentFindResult as DocumentFindResult } from '../../documents/list_documents_for_agent';
import type { ToolDefinition } from '../types';
import { listDocuments } from './helpers/list_documents';

export const documentFindArgs = z.object({
  folderPath: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Filter by folder path (e.g., "contracts/2024", "marketing"). Supports fuzzy matching — handles typos, case differences, singular/plural. Filters to documents directly in the specified folder, not recursively. Nested paths use "/" separator. Omit to search all folders.',
    ),
  extension: z
    .string()
    .min(1)
    .transform((val) => (val.startsWith('.') ? val.slice(1) : val))
    .transform((val) => val.toLowerCase())
    .optional()
    .describe(
      'Filter by file extension without dot (e.g., "pdf", "docx", "xlsx"). Auto-normalized to lowercase.',
    ),
  teamId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Filter by team ID. Only returns documents belonging to this team. You must be a member of the team.',
    ),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .optional()
    .describe(
      'Filter documents created on or after this date. UTC date in YYYY-MM-DD format (e.g., "2026-01-01").',
    ),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .optional()
    .describe(
      'Filter documents created on or before this date. UTC date in YYYY-MM-DD format (e.g., "2026-03-31").',
    ),
  fileName: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Search by file name (fuzzy match — handles typos, case differences, partial names). For semantic/content search, use rag_search instead.',
    ),
  sortBy: z
    .enum(['createdAt', 'name'])
    .optional()
    .describe('Sort field. Default: "createdAt".'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('Sort direction. Default: "desc" (newest first).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max results to return, 1-50. Default: 20.'),
  cursor: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Pagination offset from previous response. Pass the exact numeric value returned to get the next page. Do not fabricate values.',
    ),
});

export const documentFindTool: ToolDefinition = {
  name: 'document_find',
  availability: 'any',
  sandboxBridge: true,
  tool: createTool({
    description: `Find and filter documents in the knowledge base — by folder, extension, team, date range, or fuzzy file name; count matches via totalCount; paginate large sets.

NOT FOR: semantic/content search → rag_search; reading indexed content → document_retrieve with the fileId; extracting data from uploaded files → pdf, docx, text, excel, image, or pptx tools with the fileId.

RESPONSE: documents [{fileId, title, extension, folderPath, teamId, createdAt (Unix ms UTC), sizeBytes}] — fileId works with document_retrieve, the extraction tools, and any tool operating on stored files. totalCount is null when the scan limit was reached (count unknown — NOT zero results). If warning is present, results may be incomplete — narrow your filters before continuing.

PAGINATION: first call omits cursor; while hasMore is true, pass back the returned cursor.

TIPS: combine filters; for large document sets always provide at least one filter (folderPath, extension, teamId, or date range) to ensure complete results.`,
    inputSchema: documentFindArgs,
    execute: async (ctx, args): Promise<DocumentFindResult> => {
      return listDocuments(ctx, args);
    },
  }),
} as const satisfies ToolDefinition;
