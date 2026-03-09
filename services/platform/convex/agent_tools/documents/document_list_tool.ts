/**
 * Convex Tool: Document List
 *
 * Browse and filter documents from the knowledge base.
 * Supports filtering by folder, extension, team, date range, and title search.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { AgentDocumentListResult as DocumentListResult } from '../../documents/list_documents_for_agent';
import type { ToolDefinition } from '../types';

import { listDocuments } from './helpers/list_documents';

export const documentListArgs = z.object({
  folderPath: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Filter by folder path (e.g., "contracts/2024", "marketing"). Case-sensitive exact match. Filters to documents directly in the specified folder, not recursively. Nested paths use "/" separator. Omit to search all folders.',
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
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Search by document title (case-insensitive substring match). For semantic/content search, use rag_search instead.',
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

export const documentListTool: ToolDefinition = {
  name: 'document_list',
  tool: createTool({
    description: `Browse and filter documents in the knowledge base.

USE THIS TOOL TO:
• List documents in a specific folder
• Filter by file type (extension), team, or date range
• Search documents by title
• Count documents matching criteria (check totalCount in response)
• Paginate through large result sets

DO NOT USE THIS TOOL FOR:
• Semantic/content search — use rag_search instead
• Reading indexed document content — use document_retrieve with the document ID instead
• Extracting data from uploaded files — use pdf, docx, txt, excel, image, or pptx tools instead

RESPONSE FIELDS:
• documents: Array of {id, title, extension, folderPath, teamId, createdAt (Unix ms UTC), sizeBytes}
• totalCount: Total matching documents (number), or null if the scan limit was reached and the true count is unknown — this does NOT mean zero results.
• hasMore: Whether more results are available
• cursor: Pass to next call to get the next page
• warning: null normally. If present, results may be incomplete — follow the guidance in the message.

PAGINATION:
1. First call: omit cursor
2. If hasMore is true, call again with the returned cursor value
3. Repeat until hasMore is false

TIPS:
• Combine filters to narrow results (e.g., folderPath + extension + dateFrom)
• For large document sets, always provide at least one filter (folderPath, extension, teamId, or date range) to ensure complete results
• If warning is present in the response, narrow your filters before continuing
• Default sort is newest first (createdAt desc)
• Dates are interpreted as UTC`,
    args: documentListArgs,
    handler: async (ctx, args): Promise<DocumentListResult> => {
      return listDocuments(ctx, args);
    },
  }),
} as const satisfies ToolDefinition;
