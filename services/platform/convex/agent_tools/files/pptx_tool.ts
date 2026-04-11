/**
 * Convex Tool: PPTX (Presentation)
 *
 * Generate HTML slide presentations. The LLM produces the full HTML content
 * (using reveal.js or any other approach) and this tool stores it as a file.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GeneratePresentationResult {
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
      .describe('Base name for the presentation file (without extension)'),
    html: z
      .string()
      .describe(
        'Complete HTML document for the presentation. Must be a self-contained HTML file that can be opened directly in a browser.',
      ),
  }),
]);

export const pptxTool: ToolDefinition = {
  name: 'pptx',
  tool: createTool({
    description: `Presentation tool for generating HTML slide decks.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating a presentation / slides / PPT. Do NOT proactively generate presentations unless the user specifically asks.

Do NOT mention templates — this tool does not use templates. Just generate the content directly.

TO READ EXISTING PPTX FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a PPTX file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across PPTX files: use rag_search with operation='search'

OPERATIONS:

1. generate - Generate an HTML slide presentation
   Parameters:
   - fileName: Base name for the file (without extension)
   - html: A complete, self-contained HTML document for the presentation.
     Use reveal.js (loaded from CDN: https://cdn.jsdelivr.net/npm/reveal.js@5) as the slide framework.
     You have full control over styling, layout, colors, animations, and themes.
     The HTML must work when opened directly in a browser with no server needed.
   Returns: { success, fileStorageId, downloadUrl, fileName, contentType, size }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: pptxArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<GeneratePresentationResult> => {
      const { organizationId } = ctx;
      if (!organizationId) {
        throw new Error(
          'organizationId is required to generate a presentation',
        );
      }

      debugLog('tool:pptx generate start', {
        fileName: args.fileName,
      });

      try {
        const result = await ctx.runAction(
          internal.documents.internal_actions.storeRawContent,
          {
            organizationId,
            fileName: args.fileName,
            content: args.html,
            contentType: 'text/html',
            extension: 'html',
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
        } as GeneratePresentationResult;
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
