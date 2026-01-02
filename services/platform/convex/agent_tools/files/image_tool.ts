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
   Parameters:
   - fileName: Base name for the image (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The Markdown/HTML text or URL to capture
   Returns: { operation, success, url, fileName, contentType, size }

2. analyze - Analyze an uploaded image using a vision model
   **CRITICAL: You MUST provide the fileId parameter.**
   The fileId is provided in the context when users upload images (look for "fileId" in the attachment info).
   DO NOT use imageUrl for uploaded images - it will fail because internal URLs are not accessible.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - question: What you want to know about the image
   Returns: { operation, success, analysis, model }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "chart", "sourceType": "html", "content": "<div>...</div>" }
• Analyze: { "operation": "analyze", "fileId": "kg2bazp7fbgt9srq63knfagjrd7yfenj", "question": "What is in this image?" }

CRITICAL RULES:
1. For analyze operation, ALWAYS use the fileId from the image attachment context. NEVER use imageUrl for uploaded images.
2. The fileId looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj" (alphanumeric string starting with "k").
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
        .describe(
          "For 'generate': Base name for the image file (without extension)",
        ),
      sourceType: z
        .enum(['markdown', 'html', 'url'])
        .optional()
        .describe("For 'generate': Type of source content"),
      content: z
        .string()
        .optional()
        .describe(
          "For 'generate': Markdown text, HTML content, or URL to capture",
        ),
      imageOptions: z
        .object({
          width: z.number().optional(),
          height: z.number().optional(),
          fullPage: z.boolean().optional(),
          scale: z.number().min(1).max(4).optional(),
        })
        .optional()
        .describe(
          "For 'generate': Advanced image options. ONLY set width/height if user explicitly requests specific dimensions",
        ),
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
        .describe(
          "For 'generate': Whether to wrap raw content in HTML template",
        ),
      // For analyze operation
      fileId: z
        .string()
        .optional()
        .describe(
          "For 'analyze': **REQUIRED** - Convex storage ID of the image (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the image attachment context.",
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "For 'analyze': DEPRECATED - Do not use for uploaded images. Only for external public URLs.",
        ),
      question: z
        .string()
        .optional()
        .describe(
          "For 'analyze': Question or instruction about what to analyze in the image",
        ),
    }),
    handler: async (ctx: ToolCtx, args): Promise<ImageResult> => {
      const operation = args.operation ?? 'generate';

      // Handle analyze operation
      if (operation === 'analyze') {
        // REQUIRE fileId for uploaded images - imageUrl does not work for internal URLs
        if (!args.fileId) {
          const errorMsg = args.imageUrl
            ? `ERROR: You provided imageUrl but not fileId. Internal URLs (like "${args.imageUrl.substring(0, 50)}...") are NOT accessible by the vision API. You MUST use the fileId parameter instead. Look for the fileId in the image attachment context (it looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj"). Please retry with fileId.`
            : `ERROR: Missing required 'fileId' parameter. For uploaded images, you MUST provide the fileId from the image attachment context (it looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj"). Please check the attachment info and retry with fileId.`;

          return {
            operation: 'analyze',
            success: false,
            analysis: '',
            model: getVisionModel(),
            error: errorMsg,
          };
        }

        const question =
          args.question || 'Describe what you see in this image in detail.';

        debugLog('tool:image analyze start', {
          fileId: args.fileId,
          question,
        });

        try {
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
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error('[tool:image analyze] error', {
            fileId: args.fileId,
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
