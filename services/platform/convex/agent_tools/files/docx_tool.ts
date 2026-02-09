/** Convex Tool: DOCX
 *  Generate Word (.docx) documents and work with DOCX templates in the documents schema.
 *  Parse DOCX documents to extract text content.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { parseFile, type ParseFileResult } from './helpers/parse_file';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Result types
interface ListTemplatesResult {
  operation: 'list_templates';
  success: boolean;
  templates: Array<{
    documentId: string;
    storageId: string;
    title: string;
    createdAt: number;
  }>;
  totalCount: number;
  message: string;
}

interface GenerateDocxResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

type ParseDocxResult = { operation: 'parse' } & ParseFileResult;

type DocxResult = ListTemplatesResult | GenerateDocxResult | ParseDocxResult;

const sectionSchema = z.object({
  type: z
    .enum([
      'heading',
      'paragraph',
      'bullets',
      'numbered',
      'table',
      'quote',
      'code',
    ])
    .describe('Section type'),
  text: z
    .string()
    .optional()
    .describe('Text content (for heading, paragraph, quote, code)'),
  level: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe('Heading level 1-6'),
  items: z
    .array(z.string())
    .optional()
    .describe('List items (for bullets/numbered)'),
  headers: z.array(z.string()).optional().describe('Table column headers'),
  rows: z
    .array(z.array(z.string()))
    .optional()
    .describe('Table rows (2D array)'),
});

const docxArgs = z.object({
  operation: z
    .enum(['list_templates', 'generate', 'parse'])
    .optional()
    .describe(
      "Operation to perform: 'list_templates', 'generate' (default), or 'parse' (extract text from DOCX).",
    ),
  // For list_templates operation
  limit: z
    .number()
    .optional()
    .describe(
      "For 'list_templates': Maximum number of DOCX documents/templates to return (default: 50)",
    ),
  // For generate operation (optional template support)
  templateStorageId: z
    .string()
    .optional()
    .describe(
      'Convex storage ID of a DOCX template. When provided, the template is used as base, preserving headers, footers, fonts, and page setup.',
    ),
  fileName: z
    .string()
    .optional()
    .describe(
      "For 'generate': Base name for the DOCX file (without extension). Required for generate.",
    ),
  title: z.string().optional().describe('Document title'),
  subtitle: z.string().optional().describe('Document subtitle'),
  sections: z
    .array(sectionSchema)
    .optional()
    .describe(
      "For 'generate': Content sections. Each section can be a heading, paragraph, bullets, numbered list, table, quote, or code block.",
    ),
  // For parse operation
  fileId: z
    .string()
    .optional()
    .describe(
      "For 'parse': **REQUIRED** - Convex storage ID (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
    ),
  filename: z
    .string()
    .optional()
    .describe("For 'parse': Original filename (e.g., 'document.docx')"),
  user_input: z
    .string()
    .optional()
    .describe(
      "For 'parse': **REQUIRED** - The user's question or instruction about the document content",
    ),
});

export const docxTool = {
  name: 'docx' as const,
  tool: createTool({
    description: `Word document (DOCX) tool for listing templates, generating, and parsing documents.

OPERATIONS:

1. list_templates - List all available DOCX templates
   Returns all DOCX documents available in the organization.
   Returns: { templates, totalCount, message }

2. generate - Generate a DOCX with your content
   Pass templateStorageId to use a template as base (preserves headers, footers, fonts, page setup).
   Pass sections with your content. Each section can have:
   - type: "heading" | "paragraph" | "bullets" | "numbered" | "table" | "quote" | "code"
   - text, level, items, headers, rows as appropriate

3. parse - Extract text content from an existing DOCX file
   USE THIS when a user uploads a DOCX and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Original filename (e.g., "document.docx")
   - user_input: **REQUIRED** - The user's question or instruction about the document
   Returns: { success, full_text, paragraph_count, metadata }

EXAMPLES:
• List templates: { "operation": "list_templates" }
• Generate: { "operation": "generate", "templateStorageId": "kg...", "fileName": "report", "sections": [...] }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "document.docx", "user_input": "Extract the main points" }

CRITICAL: When presenting download links, copy the exact 'url' from the result. Never fabricate URLs.
`,
    args: docxArgs,
    handler: async (ctx: ToolCtx, args): Promise<DocxResult> => {
      const { organizationId } = ctx;
      const operation = args.operation ?? 'generate';

      // Handle list_templates operation
      if (operation === 'list_templates') {
        if (!organizationId) {
          return {
            operation: 'list_templates',
            success: false,
            templates: [],
            totalCount: 0,
            message:
              'No organizationId in context - cannot list DOCX templates. This tool requires organizationId to be set.',
          };
        }

        debugLog('tool:docx list_templates start', {
          organizationId,
          limit: args.limit,
        });

        try {
          const documents = await ctx.runQuery(
            internal.documents.internal_queries.listDocumentsByExtension,
            {
              organizationId,
              extension: 'docx',
              limit: args.limit,
            },
          );

          const templates = documents
            .filter((doc: any) => doc.fileId)
            .map((doc: any) => ({
              documentId: doc._id as string,
              storageId: doc.fileId as string,
              title: doc.title ?? 'Untitled Document',
              createdAt: doc._creationTime,
            }));

          debugLog('tool:docx list_templates success', {
            totalCount: templates.length,
          });

          return {
            operation: 'list_templates',
            success: true,
            templates,
            totalCount: templates.length,
            message:
              templates.length > 0
                ? `Found ${templates.length} DOCX template(s). Use the storageId when referencing these templates.`
                : 'No DOCX templates found. Upload a DOCX file first to use it as a template.',
          };
        } catch (error) {
          console.error('[tool:docx list_templates] error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Handle parse operation
      if (operation === 'parse') {
        if (!args.fileId) {
          throw new Error(
            "Missing required 'fileId' for parse operation. Get the fileId from the file attachment context.",
          );
        }
        if (!args.filename) {
          throw new Error("Missing required 'filename' for parse operation");
        }
        if (!args.user_input) {
          throw new Error(
            "Missing required 'user_input' for parse operation. Provide the user's question or instruction about the document.",
          );
        }

        const result = await parseFile(
          ctx,
          args.fileId,
          args.filename,
          'docx',
          args.user_input,
        );
        return { operation: 'parse', ...result };
      }

      // Default / generate operation
      if (!args.fileName) {
        throw new Error("Missing required 'fileName' for generate operation");
      }
      if (!args.sections || args.sections.length === 0) {
        throw new Error("Missing required 'sections' for generate operation");
      }

      // Validate that sections have actual content
      let hasContent = false;
      for (const section of args.sections) {
        if (section.text && section.text.trim().length > 0) {
          hasContent = true;
          break;
        }
        if (section.items && section.items.length > 0) {
          hasContent = true;
          break;
        }
        if (section.headers && section.rows) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) {
        console.warn(
          '[tool:docx] Sections array provided but all sections are empty',
          {
            sections: JSON.stringify(args.sections),
          },
        );
        throw new Error(
          "Sections provided but contain no content. Each section needs 'text' for headings/paragraphs, 'items' for lists, or 'headers'/'rows' for tables.",
        );
      }

      debugLog('tool:docx generate start', {
        fileName: args.fileName,
        sectionsCount: args.sections.length,
        hasTemplate: !!args.templateStorageId,
      });

      try {
        const sections = args.sections ?? [];

        // If templateStorageId is provided, use template-based generation
        if (args.templateStorageId) {
          const result = await ctx.runAction(
            internal.documents.internal_actions.generateDocxFromTemplate,
            {
              fileName: args.fileName,
              content: {
                title: args.title,
                subtitle: args.subtitle,
                sections,
              },
              templateStorageId: args.templateStorageId as Id<'_storage'>,
            },
          );

          debugLog('tool:docx generate (from template) success', {
            fileName: result.fileName,
            fileId: result.fileId,
            size: result.size,
          });

          return {
            operation: 'generate',
            ...result,
          } as GenerateDocxResult;
        }

        // Otherwise, generate from scratch
        const result = await ctx.runAction(
          internal.documents.internal_actions.generateDocx,
          {
            fileName: args.fileName,
            content: {
              title: args.title,
              subtitle: args.subtitle,
              sections,
            },
          },
        );

        debugLog('tool:docx generate success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return {
          operation: 'generate',
          ...result,
        } as GenerateDocxResult;
      } catch (error) {
        console.error('[tool:docx generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
