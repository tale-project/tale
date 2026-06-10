/** Convex Tool: Generate Image
 *  Create an image from a text prompt using the workspace's image model and
 *  show it inline in the chat reply.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateImageResult {
  success: boolean;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  error?: string;
}

export const generateImageTool = {
  name: 'generate_image' as const,
  tool: createTool({
    description: `Generate an image from a text description using the workspace's image model, shown inline in your reply.

WHEN TO USE: only when the user explicitly asks to create, generate, draw, paint, or design an image / picture / logo / illustration. Do NOT call this to analyze or describe an existing uploaded image — use the "image" tool for that.

Parameters:
- prompt: a vivid, self-contained description of the image to create. Fold any style, mood, composition, and color guidance the user gave into this one sentence; the image model does not see the conversation.

Returns: { success, downloadUrl, fileName, mimeType, error? }

AFTER GENERATING: the image is already shown to the user as an inline card. Do NOT paste the downloadUrl, do NOT say "here is the link", and do NOT describe the image at length — a brief confirmation is enough. If the result reports success: false, tell the user image generation is unavailable and relay the \`error\` field.`,
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .describe(
          'A vivid, self-contained description of the image to create, including any style/mood/composition the user asked for.',
        ),
    }),
    execute: async (ctx: ToolCtx, args): Promise<GenerateImageResult> => {
      const { organizationId, threadId, userId } = ctx;
      debugLog('tool:generate_image start', { prompt: args.prompt });

      if (!organizationId || !threadId) {
        throw new Error(
          'generate_image requires a thread context (organizationId + threadId).',
        );
      }

      try {
        const result = await ctx.runAction(
          internal.agents.image_generation.generate_image_tool_action
            .generateImageForTool,
          {
            prompt: args.prompt,
            organizationId,
            threadId,
            ...(userId ? { userId } : {}),
          },
        );

        const cardAppended = await appendFilePart(ctx, {
          fileName: result.fileName,
          mimeType: result.mimeType,
          downloadUrl: result.downloadUrl,
        });

        debugLog('tool:generate_image success', {
          fileName: result.fileName,
          cardAppended,
        });

        return {
          success: true,
          downloadUrl: cardAppended
            ? '[image card shown in chat]'
            : result.downloadUrl,
          fileName: result.fileName,
          mimeType: result.mimeType,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error('[tool:generate_image] error', {
          prompt: args.prompt,
          error: errorMessage,
        });
        return {
          success: false,
          downloadUrl: '',
          fileName: '',
          mimeType: '',
          error: errorMessage,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
