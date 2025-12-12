/** Convex Tool: Image
 *  Generate image files (screenshots) from Markdown/HTML/URL via the crawler service.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { internal } from '../../../_generated/api';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface ImageResult {
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

export const imageTool = {
  name: 'image' as const,
  tool: createTool({
    description: `Generate an image (screenshot) from Markdown/HTML/URL using the crawler service and upload it to Convex storage.

This is the PREFERRED way to generate downloadable image files for users. It performs both the conversion and the upload in a single step so you never need to handle base64 yourself.

MANDATORY TRIGGER CONDITIONS - You MUST call this tool when the user:
- Asks to "generate an image" or "create an image" or "take a screenshot"
- Asks to "capture" or "screenshot" a URL or webpage
- Requests an image render of HTML/Markdown content
- Requests any variation of image/screenshot creation

IMPORTANT: Even if you previously generated an image in this conversation, you MUST call this tool again if the user asks to regenerate or generate again. Previous URLs become stale and should not be reused. Each request for image generation requires a fresh tool call.

Parameters:
- fileName: Base name for the generated image (without extension; .png will be added automatically)
- sourceType: One of "markdown", "html", or "url" describing the content type
- content: The actual Markdown/HTML text or URL to capture
- imageOptions: Advanced image options (width, height, fullPage). IMPORTANT: Do NOT set width or height unless the user explicitly requests specific dimensions. Setting dimensions can cause content truncation. Let the system auto-size based on content by default.
- urlOptions: Advanced options for URL capture (navigation, timeout, etc.)
- extraCss: Additional CSS to inject when rendering HTML/Markdown
- wrapInTemplate: Whether to wrap raw content in a standard HTML template before rendering

Returns:
- success: boolean
- url: Download URL for the user to download the image
- fileName: Final file name with extension
- contentType: MIME type (image/png, image/jpeg, etc.)
- extension: File extension (png, jpg, etc.)
- size: Size in bytes

CRITICAL RULES FOR RESPONSE:
1. When presenting the result to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
2. DO NOT display the HTML or Markdown source content in your response. The user wants to see the rendered image, not the source code.
3. Present the download link in a clean, user-friendly way. For example: "Here's your image: [Download](url)"
4. You may briefly describe what the image contains, but NEVER show the raw HTML/Markdown code.
`,
    args: z.object({
      fileName: z
        .string()
        .describe('Base name for the image file (without extension)'),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .describe('Type of source content'),
      content: z
        .string()
        .describe('Markdown text, HTML content, or URL to capture'),
      imageOptions: z
        .object({
          width: z.number().optional(),
          height: z.number().optional(),
          fullPage: z.boolean().optional(),
          scale: z.number().min(1).max(4).optional(),
        })
        .optional()
        .describe('Advanced image options. ONLY set width/height if user explicitly requests specific dimensions - otherwise omit to auto-size based on content. Scale defaults to 2.0 for high-quality Retina output'),
      urlOptions: z
        .object({
          waitUntil: z
            .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
            .optional()
            .describe(
              'Wait condition for URL loading: "networkidle" (default, best for dynamic pages), "load" (faster, for static pages), "domcontentloaded" (DOM ready), "commit" (first response)',
            ),
        })
        .optional()
        .describe('Options for URL screenshot capture'),
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
    handler: async (ctx: ToolCtx, args): Promise<ImageResult> => {
      debugLog('tool:image start', {
        fileName: args.fileName,
        sourceType: args.sourceType,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.generateDocumentInternal,
          {
            fileName: args.fileName,
            sourceType: args.sourceType,
            outputFormat: 'image',
            content: args.content,
            imageOptions: args.imageOptions,
            urlOptions: args.urlOptions,
            extraCss: args.extraCss,
            wrapInTemplate: args.wrapInTemplate,
          },
        );

        debugLog('tool:image success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return result as ImageResult;
      } catch (error) {
        console.error('[tool:image] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;

