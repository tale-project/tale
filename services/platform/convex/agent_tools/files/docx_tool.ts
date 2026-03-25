/** Convex Tool: DOCX
 *  Generate Word (.docx) documents and work with DOCX templates in the documents schema.
 *  Parse DOCX documents to extract text content.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ListDocumentsByExtensionResult } from '../../documents/types';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import { appendFilePart } from './helpers/append_file_part';
import { getAgentModelId } from './helpers/get_agent_model';
import { parseFile, type ParseFileResult } from './helpers/parse_file';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Result types
interface ListTemplatesResult {
  operation: 'list_templates';
  success: boolean;
  templates: Array<{
    fileId: string;
    title: string;
    createdAt: number;
  }>;
  totalCount: number;
  message: string;
}

interface GenerateDocxResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
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

const docxArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list_templates'),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of DOCX documents/templates to return (default: 50)',
      ),
  }),
  z.object({
    operation: z.literal('generate'),
    templateStorageId: z
      .string()
      .optional()
      .describe(
        'Convex storage ID of a DOCX template. When provided, the template is used as base, preserving headers, footers, fonts, and page setup.',
      ),
    fileName: z
      .string()
      .describe('Base name for the DOCX file (without extension)'),
    title: z.string().optional().describe('Document title'),
    subtitle: z.string().optional().describe('Document subtitle'),
    sections: z
      .array(sectionSchema)
      .optional()
      .describe(
        'Content sections. Each section can be a heading, paragraph, bullets, numbered list, table, quote, or code block.',
      ),
    sourceType: z
      .enum(['markdown', 'html'])
      .optional()
      .describe(
        'Source type when generating from markdown or HTML content instead of sections. Use this to quickly convert existing markdown/HTML to DOCX.',
      ),
    content: z
      .string()
      .optional()
      .describe(
        'Markdown or HTML text content. Use with sourceType. This is the fastest way to generate DOCX from the same content used for PDF generation.',
      ),
  }),
  z.object({
    operation: z.literal('parse'),
    fileId: z
      .string()
      .describe(
        "Convex storage ID (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Original filename (e.g., 'document.docx'). Optional — auto-resolved from file metadata if omitted.",
      ),
    user_input: z
      .string()
      .describe(
        "The user's question or instruction about the document content",
      ),
  }),
]);

export const docxTool = {
  name: 'docx' as const,
  tool: createTool({
    description: `Word document (DOCX) tool for listing templates, generating, and parsing documents.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a Word/DOCX file. Do NOT proactively generate Word documents unless the user specifically asks for this format.

OPERATIONS:

1. list_templates - List all available DOCX templates
   Returns all DOCX documents available in the organization.
   Returns: { templates, totalCount, message }

2. generate - Generate a DOCX document

   TWO MODES:

   a) From Markdown/HTML (PREFERRED for format conversion):
      Use sourceType + content to generate DOCX directly from markdown or HTML.
      This is the FASTEST way when you already have markdown/HTML content
      (e.g., converting from a previously generated PDF).
      Parameters:
      - fileName: Base name for the DOCX file (without extension)
      - sourceType: "markdown" or "html"
      - content: The markdown or HTML text
      Returns: { success, downloadUrl, fileName, contentType, size }

   b) From structured sections:
      Use sections array for fine-grained control over document structure.
      Pass templateStorageId to use a template as base.
      Parameters:
      - fileName, title, subtitle, sections, templateStorageId
      Returns: { success, downloadUrl, fileName, contentType, size }

3. parse - Extract text content from an existing DOCX file
   USE THIS when a user uploads a DOCX and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Optional — original filename (e.g., "document.docx"). Auto-resolved from file metadata if omitted.
   - user_input: **REQUIRED** - The user's question or instruction about the document
   Returns: { success, full_text, paragraph_count, metadata }

EXAMPLES:
• From markdown: { "operation": "generate", "fileName": "report", "sourceType": "markdown", "content": "# Report\\n..." }
• From HTML: { "operation": "generate", "fileName": "report", "sourceType": "html", "content": "<h1>Report</h1>..." }
• From sections: { "operation": "generate", "fileName": "report", "sections": [...] }
• With template: { "operation": "generate", "templateStorageId": "kg...", "fileName": "report", "sections": [...] }
• List templates: { "operation": "list_templates" }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "document.docx", "user_input": "Extract the main points" }

AFTER GENERATING: The file automatically appears as a download card in the chat. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this. To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: docxArgs,
    execute: async (ctx: ToolCtx, args): Promise<DocxResult> => {
      const { organizationId } = ctx;

      if (args.operation === 'list_templates') {
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
          const documents: ListDocumentsByExtensionResult = await ctx.runQuery(
            internal.documents.internal_queries.listDocumentsByExtension,
            {
              organizationId,
              extension: 'docx',
              limit: args.limit,
            },
          );

          const templates = documents
            .filter(
              (doc): doc is typeof doc & { fileId: string } => !!doc.fileId,
            )
            .map((doc) => ({
              fileId: doc.fileId,
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
                ? `Found ${templates.length} DOCX template(s). Use the fileId when referencing these templates.`
                : 'No DOCX templates found. Upload a DOCX file first to use it as a template.',
          };
        } catch (error) {
          console.error('[tool:docx list_templates] error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      if (args.operation === 'parse') {
        const model = getAgentModelId(ctx);
        const result = await parseFile(
          ctx,
          args.fileId,
          args.filename,
          'docx',
          args.user_input,
          model,
        );
        return { operation: 'parse', ...result };
      }

      // operation === 'generate'
      if (!organizationId) {
        throw new Error('organizationId is required to generate a document');
      }

      // Mode A: Generate from markdown/html content
      if (args.sourceType && args.content) {
        debugLog('tool:docx generate from content start', {
          fileName: args.fileName,
          sourceType: args.sourceType,
        });

        try {
          const result = await ctx.runAction(
            internal.documents.internal_actions.generateDocument,
            {
              organizationId,
              fileName: args.fileName,
              sourceType: args.sourceType,
              outputFormat: 'docx',
              content: args.content,
            },
          );

          debugLog('tool:docx generate from content success', {
            fileName: result.fileName,
            fileStorageId: result.fileStorageId,
            size: result.size,
          });

          const cardAppended = await appendFilePart(ctx, {
            fileName: result.fileName,
            mimeType: result.contentType,
            downloadUrl: result.downloadUrl,
          });

          return {
            operation: 'generate',
            ...result,
            downloadUrl: cardAppended
              ? '[file card shown in chat]'
              : result.downloadUrl,
          } as GenerateDocxResult;
        } catch (error) {
          console.error('[tool:docx generate from content] error', {
            fileName: args.fileName,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Mode B: Generate from structured sections
      if (!args.sections || args.sections.length === 0) {
        throw new Error(
          "Missing content for generate operation. Provide either 'sourceType' + 'content' (markdown/HTML) or 'sections' array.",
        );
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
              organizationId,
              fileName: args.fileName,
              content: {
                title: args.title,
                subtitle: args.subtitle,
                sections,
              },
              templateStorageId: toId<'_storage'>(args.templateStorageId),
            },
          );

          debugLog('tool:docx generate (from template) success', {
            fileName: result.fileName,
            fileStorageId: result.fileStorageId,
            size: result.size,
          });

          const cardAppended = await appendFilePart(ctx, {
            fileName: result.fileName,
            mimeType: result.contentType,
            downloadUrl: result.downloadUrl,
          });

          return {
            operation: 'generate',
            ...result,
            downloadUrl: cardAppended
              ? '[file card shown in chat]'
              : result.downloadUrl,
          } as GenerateDocxResult;
        }

        // Otherwise, generate from scratch
        const result = await ctx.runAction(
          internal.documents.internal_actions.generateDocx,
          {
            organizationId,
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
          fileStorageId: result.fileStorageId,
          size: result.size,
        });

        const cardAppended = await appendFilePart(ctx, {
          fileName: result.fileName,
          mimeType: result.contentType,
          downloadUrl: result.downloadUrl,
        });

        return {
          operation: 'generate',
          ...result,
          downloadUrl: cardAppended
            ? '[file card shown in chat]'
            : result.downloadUrl,
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
