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
    description: `Presentation / slide deck capability.

DO NOT CALL THIS TOOL. Instead, output the presentation directly in the chat as a fenced HTML code block.

When the user asks for a presentation, slides, or PPT:
1. Generate a complete, self-contained HTML document using reveal.js (CDN: https://cdn.jsdelivr.net/npm/reveal.js@5)
2. Output it as a \`\`\`html code block in your response
3. The chat has a Canvas preview pane that renders HTML directly — the user can view the slides without downloading anything

Only call this tool's "generate" operation if the user explicitly asks to export or download the presentation as a file.

TO READ EXISTING PPTX FILE CONTENT: use the rag_search tool with operation='retrieve' and the fileId.
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
