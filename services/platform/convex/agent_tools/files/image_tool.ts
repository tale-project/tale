/** Convex Tool: Image
 *  Analyze images using a dedicated vision model to extract information.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import type { ToolDefinition } from '../types';
import { analyzeImage } from './helpers/analyze_image';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface AnalyzeImageResult {
  operation: 'analyze';
  success: boolean;
  analysis: string;
  model: string;
  error?: string;
}

type ImageResult = AnalyzeImageResult;

export const imageTool = {
  name: 'image' as const,
  tool: createTool({
    description: `Tool for analyzing uploaded images using a vision model.

OPERATIONS:

1. analyze - Analyze an uploaded image using a vision model
   The fileId is provided in the context when users upload images (look for "fileId" in the attachment info).
   Parameters:
   - operation: "analyze"
   - fileId: Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - question: The user's question or instruction about the image
   Returns: { operation, success, analysis, model }

EXAMPLES:
• Analyze: { "operation": "analyze", "fileId": "kg2bazp7fbgt9srq63knfagjrd7yfenj", "question": "What is in this image?" }

CRITICAL RULES:
1. For analyze operation, ALWAYS use the fileId from the image attachment context.
2. The fileId looks like "kg2bazp7fbgt9srq63knfagjrd7yfenj" (alphanumeric string starting with "k").
`,
    inputSchema: z.discriminatedUnion('operation', [
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
      const { fileId, question } = args;

      debugLog('tool:image analyze start', { fileId, question });

      try {
        const orgSlug = ctx.organizationId
          ? await resolveOrgSlug(ctx, ctx.organizationId)
          : undefined;
        const result = await analyzeImage(ctx, {
          fileId: toId<'_storage'>(fileId),
          question,
          orgSlug,
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
    },
  }),
} as const satisfies ToolDefinition;
