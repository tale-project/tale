/** Convex Tool: Image
 *  Generate image files (screenshots) from Markdown/HTML/URL via the crawler service.
 *  Analyze images using a dedicated vision model to extract information.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
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
    description: `Tool for creating visual content as images and analyzing uploaded images.

HOW THIS TOOL WORKS:
You write HTML/CSS or Markdown, and this tool renders it into a high-quality PNG/JPEG image using a headless browser. Think of it as a canvas — you are the designer, and HTML/CSS is your paintbrush. You can create ANY visual content this way.

WHEN A USER ASKS YOU TO "CREATE AN IMAGE" OR "GENERATE A PICTURE":
- ALWAYS try to fulfill the request by composing HTML/CSS with inline SVG graphics.
- For illustrations and scenes (e.g., "a puppy by a river", "a sunset over mountains"): use inline SVG with shapes, gradients, and paths to create a stylized illustration. Combine SVG elements creatively — circles, ellipses, paths, gradients, filters — to build the scene. The result will be a clean, vector-style illustration.
- For data visuals (charts, tables, diagrams, infographics): use HTML/CSS with flexbox/grid layouts.
- For text-heavy content (reports, cards, formatted text): use Markdown or styled HTML.
- Only say you cannot generate an image if the request truly requires photorealistic AI generation (like a real photograph). Even then, offer to create a stylized SVG illustration as an alternative.

WHEN A USER SENDS A URL OR ASKS FOR A SCREENSHOT/CAPTURE:
- If a user sends a URL and asks to "capture", "screenshot", "save as image", or simply wants to see what a page looks like — use sourceType "url" with the URL as content.
- This also works when a user wants to archive or share a visual snapshot of any web page.
- You can set urlOptions.waitUntil to "networkidle" for pages with dynamic content, or "domcontentloaded" for faster capture.
- You can set imageOptions.width/height to control the viewport size, and imageOptions.fullPage to capture the entire scrollable page.

OPERATIONS:

1. generate - Create an image by rendering your HTML/Markdown content, or capture a URL screenshot
   Parameters:
   - fileName: Base name for the image (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The HTML/Markdown you wrote, or a URL to capture
   Returns: { operation, success, url, fileName, contentType, size }

   DESIGN TIPS:
   - Use sourceType "html" for most visual content — it gives you full control over layout and styling.
   - Write complete, self-contained HTML with all styles inline or in a <style> tag.
   - Use SVG for illustrations: <svg viewBox="0 0 800 600">...</svg> inside your HTML. Combine basic shapes (rect, circle, ellipse, path, polygon) with gradients (linearGradient, radialGradient) and transforms to create scenes.
   - Use modern CSS (flexbox, grid, gradients, shadows, border-radius, backdrop-filter) for polished layouts.
   - The renderer supports CJK fonts (Chinese, Japanese, Korean), emoji, and code highlighting.
   - Use sourceType "markdown" only for simple text, lists, or basic tables.

2. analyze - Analyze an uploaded image using a vision model
   **CRITICAL: You MUST provide the fileId and question parameters.**
   The fileId is provided in the context when users upload images (look for "fileId" in the attachment info).
   DO NOT use imageUrl for uploaded images - it will fail because internal URLs are not accessible.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - question: **REQUIRED** - The user's question or instruction about the image
   Returns: { operation, success, analysis, model }

EXAMPLES:
• SVG illustration: { "operation": "generate", "fileName": "puppy-by-river", "sourceType": "html", "content": "<html><body style='margin:0'><svg viewBox='0 0 800 600' xmlns='http://www.w3.org/2000/svg'><!-- sky gradient, river, trees, puppy made from SVG shapes --></svg></body></html>" }
• Infographic: { "operation": "generate", "fileName": "sales-report", "sourceType": "html", "content": "<div style='font-family:sans-serif;padding:40px;background:linear-gradient(...)'>...</div>" }
• Data table: { "operation": "generate", "fileName": "comparison", "sourceType": "markdown", "content": "## Feature Comparison\\n| Feature | Plan A | Plan B |\\n|---|---|---|\\n| Storage | 10GB | 100GB |" }
• Web screenshot: { "operation": "generate", "fileName": "homepage", "sourceType": "url", "content": "https://example.com" }
• Analyze: { "operation": "analyze", "fileId": "kg2bazp7fbgt9srq63knfagjrd7yfenj", "question": "What is in this image?" }

CRITICAL RULES:
1. For generate operation, when presenting download links, copy the EXACT 'url' from the result. Never fabricate or modify URLs.
2. For analyze operation, ALWAYS use the fileId from the image attachment context. NEVER use imageUrl for uploaded images.
3. The fileId looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj" (alphanumeric string starting with "k").
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
          "For 'analyze': **REQUIRED** - The user's question or instruction about the image",
        ),
    }),
    handler: async (ctx: ToolCtx, args): Promise<ImageResult> => {
      const operation = args.operation ?? 'generate';

      // Handle analyze operation
      if (operation === 'analyze') {
        // REQUIRE fileId for uploaded images - imageUrl does not work for internal URLs
        if (!args.fileId) {
          const errorMsg = args.imageUrl
            ? `ERROR: You provided imageUrl but not fileId. Internal URLs (like "${args.imageUrl.slice(0, 50)}...") are NOT accessible by the vision API. You MUST use the fileId parameter instead. Look for the fileId in the image attachment context (it looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj"). Please retry with fileId.`
            : `ERROR: Missing required 'fileId' parameter. For uploaded images, you MUST provide the fileId from the image attachment context (it looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj"). Please check the attachment info and retry with fileId.`;

          return {
            operation: 'analyze',
            success: false,
            analysis: '',
            model: getVisionModel(),
            error: errorMsg,
          };
        }

        // REQUIRE question - we need to know what the user wants to analyze
        if (!args.question) {
          return {
            operation: 'analyze',
            success: false,
            analysis: '',
            model: getVisionModel(),
            error:
              "ERROR: Missing required 'question' parameter. Please provide the user's question or instruction about the image.",
          };
        }

        const question = args.question;

        debugLog('tool:image analyze start', {
          fileId: args.fileId,
          question,
        });

        try {
          const result = await analyzeImage(ctx, {
            fileId: toId<'_storage'>(args.fileId),
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
          internal.documents.internal_actions.generateDocument,
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
