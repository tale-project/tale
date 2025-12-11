/** Convex Tool: DOCX
 *  Generate Word (.docx) documents and work with DOCX templates in the documents schema.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';

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

type DocxResult = ListTemplatesResult | GenerateDocxResult;

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
  headers: z
    .array(z.string())
    .optional()
    .describe('Table column headers'),
  rows: z
    .array(z.array(z.string()))
    .optional()
    .describe('Table rows (2D array)'),
});

const docxArgs = z.object({
  operation: z
    .enum(['list_templates', 'generate'])
    .optional()
    .describe(
      "Operation to perform: 'list_templates' (list available DOCX templates) or 'generate' (create DOCX with content). When omitted, defaults to 'generate' for backward compatibility.",
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
      "Convex storage ID of a DOCX template. When provided, the template is used as base, preserving headers, footers, fonts, and page setup.",
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
});

export const docxTool = {
  name: 'docx' as const,
  tool: createTool({
    description: `Word document (DOCX) tool for listing templates and generating documents.

OPERATIONS:

1. list_templates - List all available DOCX templates
   Returns all DOCX documents available in the organization.
   Returns:
   - templates: Array of { documentId, storageId, title, createdAt }
   - totalCount: Number of templates found

2. generate - Generate a DOCX with your content
   Pass templateStorageId to use a template as base.
   When a template is provided, the generated document preserves:
   - Headers and footers (company logo, page numbers)
   - Font families and styles
   - Page setup (margins, orientation, size)

   Pass sections with your content. Each section can have:
   - type: "heading" | "paragraph" | "bullets" | "numbered" | "table" | "quote" | "code"
   - text: Text content (for heading, paragraph, quote, code)
   - level: Heading level 1-6 (for headings)
   - items: Array of strings (for bullets/numbered lists)
   - headers: Column headers (for tables)
   - rows: 2D array of cell values (for tables)

REQUIRED WORKFLOW:
1. ALWAYS call list_templates first to get available templates
2. Choose the most appropriate template based on context (e.g., company branding, document type)
3. Call generate with the chosen templateStorageId AND your sections
4. Copy the exact 'url' value from the result - never fabricate URLs

EXAMPLES:

Step 1 - List templates: { "operation": "list_templates" }
Returns: { templates: [{ documentId: "...", storageId: "kg...", title: "Company Template.docx", ... }], totalCount: 3 }

Step 2 - Generate with chosen template:
{
  "operation": "generate",
  "templateStorageId": "kg...",
  "fileName": "q1_report",
  "title": "Q1 Report",
  "sections": [
    {"type": "heading", "level": 1, "text": "Introduction"},
    {"type": "paragraph", "text": "This is the intro paragraph."},
    {"type": "bullets", "items": ["Point 1", "Point 2", "Point 3"]},
    {"type": "table", "headers": ["Name", "Value"], "rows": [["Item A", "100"], ["Item B", "200"]]}
  ]
}

RETURNS (for generate):
- success: boolean
- url: Download URL for the user to download the file
- fileName: Final file name with extension
- contentType: MIME type of the generated file
- size: Size in bytes

RETURNS (for list_templates):
- success: boolean
- templates: Array of DOCX documents/templates in the organization
- totalCount: number of templates/documents
- message: human-readable summary

CRITICAL:
1. ALWAYS call list_templates first before generating any document.
2. ALWAYS use a templateStorageId when templates are available.
3. When presenting the download link to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
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
            internal.documents.listDocumentsByExtension,
            {
              organizationId,
              extension: 'docx',
              limit: args.limit,
            },
          );

          const templates = documents
            .filter((doc) => doc.fileId)
            .map((doc) => ({
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
        console.warn('[tool:docx] Sections array provided but all sections are empty', {
          sections: JSON.stringify(args.sections),
        });
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
            internal.documents.generateDocxFromTemplateInternal,
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
          internal.documents.generateDocxInternal,
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
