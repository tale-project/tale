/** Convex Tool: DOCX
 *  Generate Word (.docx) documents from markdown/HTML or structured sections.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Result types
interface GenerateDocxResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
}

type DocxResult = GenerateDocxResult;

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
    operation: z.literal('generate'),
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
]);

export const docxTool = {
  name: 'docx' as const,
  tool: createTool({
    description: `Word document (DOCX) tool for generating documents.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a Word/DOCX file. Do NOT proactively generate Word documents unless the user specifically asks for this format.

TO READ WORD/DOCX FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a DOCX file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across DOCX files: use rag_search with operation='search'

OPERATIONS:

1. generate - Generate a DOCX document

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
      Parameters:
      - fileName, title, subtitle, sections
      Returns: { success, downloadUrl, fileName, contentType, size }

EXAMPLES:
• From markdown: { "operation": "generate", "fileName": "report", "sourceType": "markdown", "content": "# Report\\n..." }
• From HTML: { "operation": "generate", "fileName": "report", "sourceType": "html", "content": "<h1>Report</h1>..." }
• From sections: { "operation": "generate", "fileName": "report", "sections": [...] }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: docxArgs,
    execute: async (ctx: ToolCtx, args): Promise<DocxResult> => {
      const { organizationId } = ctx;

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
      });

      try {
        const sections = args.sections ?? [];

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
