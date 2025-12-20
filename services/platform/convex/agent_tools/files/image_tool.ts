'use node';

/** Convex Tool: Image
 *  Generate image files (screenshots) from Markdown/HTML/URL via the crawler service.
 *  Analyze images using a dedicated vision model to extract information.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { Id } from '../../_generated/dataModel';
import { analyzeImage } from './helpers/analyze_image';
import { analyzeImageByUrl } from './helpers/analyze_image_by_url';
import { getVisionModel } from './helpers/vision_agent';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateImageResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

interface AnalyzeImageResult {
  operation: 'analyze';
  success: boolean;
  analysis: string;
  model: string;
  error?: string;
}

type ImageResult = GenerateImageResult | AnalyzeImageResult;

export const imageTool = {
  name: 'image' as const,
  tool: createTool({
    description: `Image tool for generating and analyzing images.

OPERATIONS:

1. generate - Generate an image (screenshot) from Markdown/HTML/URL
   This is the PREFERRED way to generate downloadable image files.
   MANDATORY TRIGGER CONDITIONS - You MUST call this when the user:
   - Asks to "generate an image" or "create an image" or "take a screenshot"
   - Asks to "capture" or "screenshot" a URL or webpage
   - Requests an image render of HTML/Markdown content
   Parameters:
   - fileName: Base name for the image (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The Markdown/HTML text or URL to capture
   - imageOptions: Advanced options (width, height, fullPage, scale)
   - urlOptions: Options for URL capture (waitUntil)
   - extraCss: Additional CSS to inject
   - wrapInTemplate: Whether to wrap in HTML template
   Returns: { operation, success, url, fileName, contentType, size }

2. analyze - Analyze an image using a vision model
   USE THIS when a user uploads an image and you need to understand its content.
   MANDATORY TRIGGER CONDITIONS - You MUST call this when:
   - The user asks about an uploaded image (what's in it, what does it show)
   - You need to extract text from an image (OCR)
   - You need to understand diagrams, charts, or visual content
   - The user asks to analyze, describe, or interpret any image attachment
   Parameters:
   - fileId: Convex storage ID of the image (preferred - uses direct storage access)
   - imageUrl: URL of the image to analyze (fallback if fileId not available)
   - question: What you want to know about the image
   Returns: { operation, success, analysis, model }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "chart", "sourceType": "html", "content": "<div>...</div>" }
• Analyze: { "operation": "analyze", "fileId": "k17abc123...", "question": "What text is in this image?" }
• Analyze (with URL fallback): { "operation": "analyze", "fileId": "k17abc123...", "imageUrl": "https://...", "question": "Describe this image" }

CRITICAL RULES FOR RESPONSE:
1. When presenting download links, copy the exact 'url' from the result. Never fabricate URLs.
2. DO NOT display HTML/Markdown source content. Show rendered results only.
3. For analyze, present the analysis clearly to the user.
`,
    args: z.object({
      operation: z
        .enum(['generate', 'analyze'])
        .optional()
        .describe("Operation: 'generate' (default) or 'analyze'"),
      // For generate operation
      fileName: z
        .string()
        .optional()
        .describe("For 'generate': Base name for the image file (without extension)"),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .optional()
        .describe("For 'generate': Type of source content"),
      content: z
        .string()
        .optional()
        .describe("For 'generate': Markdown text, HTML content, or URL to capture"),
      imageOptions: z
        .object({
          width: z.number().optional(),
          height: z.number().optional(),
          fullPage: z.boolean().optional(),
          scale: z.number().min(1).max(4).optional(),
        })
        .optional()
        .describe("For 'generate': Advanced image options. ONLY set width/height if user explicitly requests specific dimensions"),
      urlOptions: z
        .object({
          waitUntil: z
            .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
            .optional(),
        })
        .optional()
        .describe("For 'generate': Options for URL screenshot capture"),
      extraCss: z
        .string()
        .optional()
        .describe("For 'generate': Additional CSS to inject when rendering"),
      wrapInTemplate: z
        .boolean()
        .optional()
        .describe("For 'generate': Whether to wrap raw content in HTML template"),
      // For analyze operation
      fileId: z
        .string()
        .optional()
        .describe("For 'analyze': Convex storage ID of the image (preferred - uses direct storage access)"),
      imageUrl: z
        .string()
        .optional()
        .describe("For 'analyze': URL of the image (fallback if fileId doesn't work)"),
      question: z
        .string()
        .optional()
        .describe("For 'analyze': Question or instruction about what to analyze in the image"),
    }),
    handler: async (ctx: ToolCtx, args): Promise<ImageResult> => {
      const operation = args.operation ?? 'generate';

      // Handle analyze operation
      if (operation === 'analyze') {
        if (!args.fileId && !args.imageUrl) {
          throw new Error(
            "Missing required 'fileId' or 'imageUrl' for analyze operation",
          );
        }

        const question =
          args.question || 'Describe what you see in this image in detail.';

        debugLog('tool:image analyze start', {
          fileId: args.fileId,
          imageUrl: args.imageUrl?.substring(0, 100),
          question,
        });

        try {
          // Prefer using the fileId directly with the helper
          if (args.fileId) {
            debugLog('tool:image analyze using helper with fileId', {
              fileId: args.fileId,
            });

            const result = await analyzeImage(ctx, {
              fileId: args.fileId as Id<'_storage'>,
              question,
            });

            return {
              operation: 'analyze',
              success: result.success,
              analysis: result.analysis,
              model: result.model,
              error: result.error,
            };
          }

          // Fall back to URL - pass it directly to the AI
          // NOTE: This works for publicly accessible URLs but may fail for internal/localhost URLs
          debugLog('tool:image analyze using URL directly', {
            imageUrl: args.imageUrl!.substring(0, 100),
          });

          const result = await analyzeImageByUrl(ctx, {
            imageUrl: args.imageUrl!,
            question,
          });

          return {
            operation: 'analyze',
            success: result.success,
            analysis: result.analysis,
            model: result.model,
            error: result.error,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('[tool:image analyze] error', {
            fileId: args.fileId,
            imageUrl: args.imageUrl?.substring(0, 100),
            error: errorMessage,
          });

          return {
            operation: 'analyze',
            success: false,
            analysis: '',
            model: getVisionModel(),
            error: errorMessage,
          };
        }
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

      debugLog('tool:image generate start', {
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

        debugLog('tool:image generate success', {
          fileName: result.fileName,
          fileId: result.fileId,
          size: result.size,
        });

        return {
          operation: 'generate',
          ...result,
        } as GenerateImageResult;
      } catch (error) {
        console.error('[tool:image generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
