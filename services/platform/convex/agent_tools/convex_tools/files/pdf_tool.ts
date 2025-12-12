/** Convex Tool: PDF
 *  Generate PDF documents from Markdown/HTML/URL via the crawler service.
 *  Parse PDF documents to extract text content.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { parseFile, type ParseFileResult } from './helpers/parse_file';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GeneratePdfResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
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
    description: `PDF tool for generating and parsing PDF documents.

OPERATIONS:

1. generate - Generate a PDF from Markdown/HTML/URL
   This is the PREFERRED way to generate downloadable PDF files.
   Parameters:
   - fileName: Base name for the PDF (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The Markdown/HTML text or URL to capture
   - pdfOptions: Advanced options (format, landscape, margins, etc.)
   - urlOptions: Options for URL capture (waitUntil, etc.)
   - extraCss: Additional CSS to inject
   - wrapInTemplate: Whether to wrap in HTML template
   Returns: { success, url, fileName, contentType, size }

2. parse - Extract text content from an existing PDF file
   USE THIS when a user uploads a PDF and you need to read its content.
   Parameters:
   - url: URL of the PDF file (from Convex storage or accessible HTTP URL)
   - filename: Original filename (e.g., "report.pdf")
   Returns: { success, full_text, page_count, metadata }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "report", "sourceType": "markdown", "content": "# Report\\n..." }
• Parse: { "operation": "parse", "url": "https://storage.convex.cloud/...", "filename": "report.pdf" }

CRITICAL: When presenting download links, copy the exact 'url' from the result. Never fabricate URLs.
`,
    args: z.object({
      operation: z
        .enum(['generate', 'parse'])
        .optional()
        .describe("Operation: 'generate' (default) or 'parse'"),
      // For generate operation
      fileName: z
        .string()
        .optional()
        .describe("For 'generate': Base name for the PDF file (without extension)"),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .optional()
        .describe("For 'generate': Type of source content"),
      content: z
        .string()
        .optional()
        .describe("For 'generate': Markdown text, HTML content, or URL to capture"),
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
        .describe("For 'generate': Advanced PDF options"),
      urlOptions: z
        .object({
          waitUntil: z
            .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
            .optional(),
        })
        .optional()
        .describe("For 'generate': Options for URL capture"),
      extraCss: z
        .string()
        .optional()
        .describe("For 'generate': Additional CSS to inject"),
      wrapInTemplate: z
        .boolean()
        .optional()
        .describe("For 'generate': Whether to wrap in HTML template"),
      // For parse operation
      url: z
        .string()
        .optional()
        .describe("For 'parse': URL of the PDF file to parse"),
      filename: z
        .string()
        .optional()
        .describe("For 'parse': Original filename (e.g., 'report.pdf')"),
    }),
    handler: async (ctx: ToolCtx, args): Promise<PdfResult> => {
      const operation = args.operation ?? 'generate';

      // Handle parse operation
      if (operation === 'parse') {
        if (!args.url) {
          throw new Error("Missing required 'url' for parse operation");
        }
        if (!args.filename) {
          throw new Error("Missing required 'filename' for parse operation");
        }

        const result = await parseFile(args.url, args.filename, 'pdf');
        return { operation: 'parse', ...result };
      }

      // Default: generate operation
      if (!args.fileName) {
        throw new Error("Missing required 'fileName' for generate operation");
      }
      if (!args.sourceType) {
        throw new Error("Missing required 'sourceType' for generate operation");
      }
      if (!args.content) {
        throw new Error("Missing required 'content' for generate operation");
      }

      debugLog('tool:pdf generate start', {
        fileName: args.fileName,
        sourceType: args.sourceType,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.generateDocumentInternal,
          {
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
          fileId: result.fileId,
          size: result.size,
        });

        return {
          operation: 'generate',
          ...result,
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

