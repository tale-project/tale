/** Convex Tool: PDF
 *  Generate PDF documents from Markdown/HTML/URL via the crawler service.
 *  Parse PDF documents to extract text content.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { appendFilePart } from './helpers/append_file_part';
import { getAgentModelId } from './helpers/get_agent_model';
import { parseFile, type ParseFileResult } from './helpers/parse_file';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GeneratePdfResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

type ParsePdfResult = { operation: 'parse' } & ParseFileResult;

type PdfResult = GeneratePdfResult | ParsePdfResult;

export const pdfTool = {
  name: 'pdf' as const,
  tool: createTool({
    description: `PDF tool for generating, downloading, and parsing PDF documents.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a PDF file. Do NOT proactively generate PDFs unless the user specifically asks for this format.

OPERATIONS:

1. generate - Generate a PDF from Markdown/HTML, or download/capture a PDF from a URL
   This is the PREFERRED way to generate downloadable PDF files.
   Parameters:
   - fileName: Base name for the PDF (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The Markdown/HTML text or URL to capture/download
   - pdfOptions: Advanced options (format, landscape, margins, etc.)
   - urlOptions: Options for URL capture (waitUntil, etc.)
   - extraCss: Additional CSS to inject
   - wrapInTemplate: Whether to wrap in HTML template
   Returns: { success, fileStorageId, downloadUrl, fileName, contentType, size }

   URL MODE (sourceType: "url"):
   • For web pages: renders the page as a PDF
   • For direct PDF links (e.g. https://example.com/report.pdf): downloads the original PDF file as-is
   • Use this to download and store existing PDF files from external URLs
   • The returned fileStorageId can be passed to document_write to save to a folder in the documents hub

2. parse - Extract text content from an existing PDF file
   USE THIS when a user uploads a PDF and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Optional — original filename (e.g., "report.pdf"). Auto-resolved from file metadata if omitted.
   - user_input: **REQUIRED** - The user's question or instruction about the PDF
   Returns: { success, full_text, page_count, metadata }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "report", "sourceType": "markdown", "content": "# Report\\n..." }
• Download existing PDF: { "operation": "generate", "fileName": "report", "sourceType": "url", "content": "https://example.com/report.pdf" }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "report.pdf", "user_input": "Summarize the key findings" }

AFTER GENERATING: The file automatically appears as a download card in the chat. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this. To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('generate'),
        fileName: z
          .string()
          .describe('Base name for the PDF file (without extension)'),
        sourceType: z
          .enum(['markdown', 'html', 'url'])
          .describe('Type of source content'),
        content: z
          .string()
          .describe('Markdown text, HTML content, or URL to capture'),
        pdfOptions: z
          .object({
            format: z.string().optional(),
            landscape: z.boolean().optional(),
            marginTop: z.string().optional(),
            marginBottom: z.string().optional(),
            marginLeft: z.string().optional(),
            marginRight: z.string().optional(),
            printBackground: z.boolean().optional(),
          })
          .optional()
          .describe('Advanced PDF options'),
        urlOptions: z
          .object({
            waitUntil: z
              .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
              .optional(),
          })
          .optional()
          .describe('Options for URL capture'),
        extraCss: z.string().optional().describe('Additional CSS to inject'),
        wrapInTemplate: z
          .boolean()
          .optional()
          .describe('Whether to wrap in HTML template'),
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
            "Original filename (e.g., 'report.pdf'). Optional — auto-resolved from file metadata if omitted.",
          ),
        user_input: z
          .string()
          .describe("The user's question or instruction about the PDF content"),
      }),
    ]),
    execute: async (ctx: ToolCtx, args): Promise<PdfResult> => {
      if (args.operation === 'parse') {
        const model = getAgentModelId(ctx);
        const result = await parseFile(
          ctx,
          args.fileId,
          args.filename,
          'pdf',
          args.user_input,
          model,
        );
        return { operation: 'parse', ...result };
      }

      // operation === 'generate'
      const { organizationId } = ctx;
      if (!organizationId) {
        throw new Error('organizationId is required to generate a PDF');
      }

      debugLog('tool:pdf generate start', {
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
            outputFormat: 'pdf',
            content: args.content,
            pdfOptions: args.pdfOptions,
            urlOptions: args.urlOptions,
            extraCss: args.extraCss,
            wrapInTemplate: args.wrapInTemplate,
          },
        );

        debugLog('tool:pdf generate success', {
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
        } as GeneratePdfResult;
      } catch (error) {
        console.error('[tool:pdf generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
