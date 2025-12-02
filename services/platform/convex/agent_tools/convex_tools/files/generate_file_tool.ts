/** Convex Tool: generate_file
 *  Generate a PDF (or image) via the crawler service, upload to Convex storage,
 *  and return the final download URL (no base64 exposed to the LLM).
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateFileResult {
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

export const generateFileTool = {
  name: 'generate_file' as const,
  tool: createTool({
    description: `Generate a PDF or image file from Markdown/HTML/URL using the crawler service and upload it to Convex storage.

This is the PREFERRED way to generate downloadable files (PDFs or images) for users. It performs both the conversion and the upload in a single step so you never need to handle base64 yourself.

MANDATORY TRIGGER CONDITIONS - You MUST call this tool when the user:
- Asks to "generate a PDF" or "create a PDF" or "export as PDF"
- Asks to "generate a PDF report" or "PDF version" of content
- Says "make me a PDF" or "produce a PDF report"
- Requests any variation of PDF document creation/regeneration
- Asks for an image render of HTML/Markdown or a screenshot of a URL

IMPORTANT: Even if you previously generated a file in this conversation, you MUST call this tool again if the user asks to regenerate or generate again. Previous URLs become stale and should not be reused. Each request for file generation requires a fresh tool call.

Parameters:
- fileName: Base name for the generated file (without extension; the correct extension will be added automatically)
- sourceType: One of "markdown", "html", or "url" describing the content type
- content: The actual Markdown/HTML text or URL to capture
- outputFormat: "pdf" or "image" (defaults to "pdf" if omitted)
- pdfOptions, imageOptions, urlOptions, extraCss, wrapInTemplate: Advanced options forwarded to the crawler service

Returns:
- success: boolean
- url: Download URL for the user to download the file
- fileName: Final file name with extension
- contentType: MIME type (e.g. application/pdf, image/png)
- extension: File extension (pdf, png, jpg, etc.)
- size: Size in bytes

CRITICAL:
1. When presenting the download link to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
`,
    args: z.object({
      fileName: z
        .string()
        .describe('Base name for the file (without extension)'),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .describe('Type of source content'),
      content: z
        .string()
        .describe('Markdown text, HTML content, or URL to capture'),
      outputFormat: z
        .enum(['pdf', 'image'])
        .default('pdf')
        .describe('Output format ("pdf" or "image"). Defaults to "pdf".'),
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
      imageOptions: z
        .object({
          width: z.number().optional(),
          height: z.number().optional(),
          fullPage: z.boolean().optional(),
        })
        .optional()
        .describe('Advanced image options for image output'),
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
    handler: async (ctx, args): Promise<GenerateFileResult> => {
      const actionCtx = ctx as unknown as ActionCtx;

      const outputFormat = args.outputFormat ?? 'pdf';

      debugLog('tool:generate_file start', {
        fileName: args.fileName,
        sourceType: args.sourceType,
        outputFormat,
      });

      try {
        const result = await actionCtx.runAction(
          internal.documents.generateDocumentInternal,
          {
            fileName: args.fileName,
            sourceType: args.sourceType,
            outputFormat,
            content: args.content,
            pdfOptions: args.pdfOptions,
            imageOptions: args.imageOptions,
            urlOptions: args.urlOptions,
            extraCss: args.extraCss,
            wrapInTemplate: args.wrapInTemplate,
          },
        );

        debugLog('tool:generate_file success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return result as GenerateFileResult;
      } catch (error) {
        console.error('[tool:generate_file] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
