/** Convex Tool: PDF
 *  Generate PDF documents from Markdown/HTML/URL via the crawler service.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface PdfResult {
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

export const pdfTool = {
  name: 'pdf' as const,
  tool: createTool({
    description: `Generate a PDF document from Markdown/HTML/URL using the crawler service and upload it to Convex storage.

This is the PREFERRED way to generate downloadable PDF files for users. It performs both the conversion and the upload in a single step so you never need to handle base64 yourself.

MANDATORY TRIGGER CONDITIONS - You MUST call this tool when the user:
- Asks to "generate a PDF" or "create a PDF" or "export as PDF"
- Asks to "generate a PDF report" or "PDF version" of content
- Says "make me a PDF" or "produce a PDF report"
- Requests any variation of PDF document creation/regeneration

IMPORTANT: Even if you previously generated a PDF in this conversation, you MUST call this tool again if the user asks to regenerate or generate again. Previous URLs become stale and should not be reused. Each request for PDF generation requires a fresh tool call.

Parameters:
- fileName: Base name for the generated PDF (without extension; .pdf will be added automatically)
- sourceType: One of "markdown", "html", or "url" describing the content type
- content: The actual Markdown/HTML text or URL to capture
- pdfOptions: Advanced PDF options (format, landscape, margins, etc.)
- urlOptions: Advanced options for URL capture (navigation, timeout, etc.)
- extraCss: Additional CSS to inject when rendering HTML/Markdown
- wrapInTemplate: Whether to wrap raw content in a standard HTML template before rendering

Returns:
- success: boolean
- url: Download URL for the user to download the PDF
- fileName: Final file name with extension
- contentType: MIME type (application/pdf)
- extension: File extension (pdf)
- size: Size in bytes

CRITICAL RULES FOR RESPONSE:
1. When presenting the result to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
2. DO NOT display the HTML or Markdown source content in your response. The user wants to download the PDF, not see the source code.
3. Present the download link in a clean, user-friendly way. For example: "Here's your PDF: [Download](url)"
4. You may briefly describe what the document contains, but NEVER show the raw HTML/Markdown code.
`,
    args: z.object({
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
        .describe('Advanced PDF options passed through to the crawler service'),
      urlOptions: z
        .object({
          waitUntil: z.string().optional(),
          timeout: z.number().optional(),
        })
        .optional()
        .describe(
          'Advanced options for URL capture (navigation, timeout, etc.)',
        ),
      extraCss: z
        .string()
        .optional()
        .describe('Additional CSS to inject when rendering HTML/Markdown'),
      wrapInTemplate: z
        .boolean()
        .optional()
        .describe(
          'Whether to wrap raw content in a standard HTML template before rendering',
        ),
    }),
    handler: async (ctx: ToolCtx, args): Promise<PdfResult> => {
      debugLog('tool:pdf start', {
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

        debugLog('tool:pdf success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return result as PdfResult;
      } catch (error) {
        console.error('[tool:pdf] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;

