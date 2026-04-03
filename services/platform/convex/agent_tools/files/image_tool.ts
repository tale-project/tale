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
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateImageResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
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
- If a user sends a URL and asks to "capture", "screenshot", "save as image", or simply wants to see what a page looks like — use operation "generate" with sourceType "url" and the URL as content.
- This also works when a user wants to archive or share a visual snapshot of any web page.
- You can set urlOptions.waitUntil to "networkidle" for pages with dynamic content, or "domcontentloaded" for faster capture.
- You can set imageOptions.width/height to control the viewport size, and imageOptions.fullPage to capture the entire scrollable page.

OPERATIONS:

1. generate - Create an image by rendering your HTML/Markdown content, or capture a URL screenshot
   Parameters:
   - operation: "generate"
   - fileName: Base name for the image (without extension)
   - sourceType: "markdown", "html", or "url"
   - content: The HTML/Markdown you wrote, or a URL to capture
   - quality (optional): "low" (1x JPEG, smallest file, default), "standard" (1x PNG), "high" (2x PNG), "ultra" (4x PNG). Use "low" unless user requests higher quality.
   Returns: { operation, success, downloadUrl, fileName, contentType, size }

   DESIGN TIPS:
   - Use sourceType "html" for most visual content — it gives you full control over layout and styling.
   - Write complete, self-contained HTML with all styles inline or in a <style> tag.
   - Use SVG for illustrations: <svg viewBox="0 0 800 600">...</svg> inside your HTML. Combine basic shapes (rect, circle, ellipse, path, polygon) with gradients (linearGradient, radialGradient) and transforms to create scenes.
   - Use modern CSS (flexbox, grid, gradients, shadows, border-radius, backdrop-filter) for polished layouts.
   - The renderer supports CJK fonts (Chinese, Japanese, Korean), emoji, and code highlighting.
   - Use sourceType "markdown" only for simple text, lists, or basic tables.

2. analyze - Analyze an uploaded image using a vision model
   The fileId is provided in the context when users upload images (look for "fileId" in the attachment info).
   Parameters:
   - operation: "analyze"
   - fileId: Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - question: The user's question or instruction about the image
   Returns: { operation, success, analysis, model }

EXAMPLES:
• SVG illustration: { "operation": "generate", "fileName": "puppy-by-river", "sourceType": "html", "content": "<html><body style='margin:0'><svg viewBox='0 0 800 600' xmlns='http://www.w3.org/2000/svg'><!-- sky gradient, river, trees, puppy made from SVG shapes --></svg></body></html>" }
• Infographic: { "operation": "generate", "fileName": "sales-report", "sourceType": "html", "content": "<div style='font-family:sans-serif;padding:40px;background:linear-gradient(...)'>...</div>" }
• Data table: { "operation": "generate", "fileName": "comparison", "sourceType": "markdown", "content": "## Feature Comparison\\n| Feature | Plan A | Plan B |\\n|---|---|---|\\n| Storage | 10GB | 100GB |" }
• Web screenshot: { "operation": "generate", "fileName": "homepage", "sourceType": "url", "content": "https://example.com" }
• Analyze: { "operation": "analyze", "fileId": "kg2bazp7fbgt9srq63knfagjrd7yfenj", "question": "What is in this image?" }

CRITICAL RULES:
1. For analyze operation, ALWAYS use the fileId from the image attachment context.
2. The fileId looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj" (alphanumeric string starting with "k").

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('generate'),
        fileName: z
          .string()
          .describe('Base name for the image file (without extension)'),
        sourceType: z
          .enum(['markdown', 'html', 'url'])
          .describe('Type of source content'),
        content: z
          .string()
          .describe('Markdown text, HTML content, or URL to capture'),
        quality: z
          .enum(['low', 'standard', 'high', 'ultra'])
          .optional()
          .describe(
            "Image quality/resolution. 'low' (1x JPEG, smallest file), 'standard' (1x PNG), 'high' (2x PNG), 'ultra' (4x PNG, largest file). Defaults to 'low'. Only increase if user explicitly requests higher quality.",
          ),
        imageOptions: z
          .object({
            width: z.number().optional(),
            height: z.number().optional(),
            fullPage: z.boolean().optional(),
          })
          .optional()
          .describe(
            'Advanced image options. ONLY set width/height if user explicitly requests specific dimensions',
          ),
        urlOptions: z
          .object({
            waitUntil: z
              .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
              .optional(),
          })
          .optional()
          .describe('Options for URL screenshot capture'),
        extraCss: z
          .string()
          .optional()
          .describe('Additional CSS to inject when rendering'),
        wrapInTemplate: z
          .boolean()
          .optional()
          .describe('Whether to wrap raw content in HTML template'),
      }),
      z.object({
        operation: z.literal('analyze'),
        fileId: z
          .string()
          .describe(
            "Convex storage ID of the image (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the image attachment context.",
          ),
        question: z
          .string()
          .describe("The user's question or instruction about the image"),
      }),
    ]),
    execute: async (ctx: ToolCtx, args): Promise<ImageResult> => {
      if (args.operation === 'analyze') {
        const { fileId, question } = args;

        debugLog('tool:image analyze start', { fileId, question });

        try {
          const result = await analyzeImage(ctx, {
            fileId: toId<'_storage'>(fileId),
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
            fileId,
            error: errorMessage,
          });

          return {
            operation: 'analyze',
            success: false,
            analysis: '',
            model: 'unknown',
            error: errorMessage,
          };
        }
      }

      const { organizationId } = ctx;
      if (!organizationId) {
        throw new Error('organizationId is required to generate an image');
      }

      debugLog('tool:image generate start', {
        fileName: args.fileName,
        sourceType: args.sourceType,
      });

      const qualityPresets = {
        low: { scale: 1, imageType: 'jpeg', quality: 80 },
        standard: { scale: 1, imageType: 'png', quality: 100 },
        high: { scale: 2, imageType: 'png', quality: 100 },
        ultra: { scale: 4, imageType: 'png', quality: 100 },
      } as const;
      const preset = qualityPresets[args.quality ?? 'low'];

      try {
        const result = await ctx.runAction(
          internal.documents.internal_actions.generateDocument,
          {
            organizationId,
            fileName: args.fileName,
            sourceType: args.sourceType,
            outputFormat: 'image',
            content: args.content,
            imageOptions: {
              ...args.imageOptions,
              scale: preset.scale,
              imageType: preset.imageType,
              quality: preset.quality,
            },
            urlOptions: args.urlOptions,
            extraCss: args.extraCss,
            wrapInTemplate: args.wrapInTemplate,
          },
        );

        debugLog('tool:image generate success', {
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
