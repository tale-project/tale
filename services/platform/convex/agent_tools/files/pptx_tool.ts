/**
 * Convex Tool: PPTX
 *
 * Generate PPTX presentations from Markdown or HTML via the crawler service.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GeneratePptxResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
}

const pptxArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('generate'),
    fileName: z
      .string()
      .describe('Base name for the PPTX file (without extension)'),
    sourceType: z.enum(['markdown', 'html']).describe('Source content type'),
    content: z
      .string()
      .describe('The Markdown or HTML content to convert to PPTX'),
  }),
]);

export const pptxTool: ToolDefinition = {
  name: 'pptx',
  tool: createTool({
    description: `PowerPoint (PPTX) tool for generating presentations from Markdown or HTML content.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting a PowerPoint/PPTX file. Do NOT proactively generate presentations unless the user specifically asks for this format.

TO READ PPTX FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a PPTX file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across PPTX files: use rag_search with operation='search'

OPERATIONS:

1. generate - Generate a PPTX from Markdown or HTML
   Parameters:
   - fileName: Base name for the PPTX (without extension)
   - sourceType: "markdown" or "html"
   - content: The Markdown or HTML content to convert
   Returns: { success, fileStorageId, downloadUrl, fileName, contentType, size }

EXAMPLES:
• Generate from Markdown: { "operation": "generate", "fileName": "Report", "sourceType": "markdown", "content": "# Slide 1\\n\\nBullet points here..." }
• Generate from HTML: { "operation": "generate", "fileName": "Report", "sourceType": "html", "content": "<h1>Slide 1</h1><ul><li>Item</li></ul>" }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: pptxArgs,
    execute: async (ctx: ToolCtx, args): Promise<GeneratePptxResult> => {
      const { organizationId } = ctx;
      if (!organizationId) {
        throw new Error(
          'organizationId is required to generate a presentation',
        );
      }

      debugLog('tool:pptx generate start', {
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
            outputFormat: 'pptx',
            content: args.content,
          },
        );

        debugLog('tool:pptx generate success', {
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
        } as GeneratePptxResult;
      } catch (error) {
        console.error('[tool:pptx generate] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
};
