/**
 * Document Assistant Tool
 *
 * Delegates document-related tasks to the specialized Document Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { getDocumentAgentGenerateResponseRef } from '../../lib/function_refs';

export const documentAssistantTool = {
  name: 'document_assistant' as const,
  tool: createTool({
    description: `Delegate document-related tasks to the specialized Document Agent.

Use this tool for ANY document-related request, including:
- Parsing uploaded PDF, Word, or PowerPoint files
- Generating PDF documents from Markdown/HTML
- Creating Excel files from structured data
- Analyzing images using vision capabilities

The Document Agent is specialized in:
- Extracting text and structure from documents
- Generating downloadable files (PDF, Excel)
- Image analysis with vision model
- Multi-step document workflows

Simply describe what you need done with the document.

EXAMPLES:
• Parse PDF: { userRequest: "Extract the content from this PDF", fileUrl: "https://...", fileName: "report.pdf" }
• Generate PDF: { userRequest: "Create a PDF report with this data: ..." }
• Analyze image: { userRequest: "What's in this image?", fileId: "kg2bazp7..." }
• Create Excel: { userRequest: "Generate an Excel file with these columns: Name, Email, Status" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's document-related request in natural language"),
      fileId: z
        .string()
        .optional()
        .describe('Convex storage ID for uploaded files (for image analysis)'),
      fileUrl: z
        .string()
        .optional()
        .describe('URL of the file to process (for parsing documents)'),
      fileName: z
        .string()
        .optional()
        .describe('Original filename (e.g., "report.pdf")'),
    }),

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      response: string;
      error?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      if (!threadId) {
        return {
          success: false,
          response: '',
          error: 'threadId is required for document_assistant to create sub-threads',
        };
      }

      try {
        // Get or create a sub-thread for this parent thread + agent combination
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'document_assistant',
            userId,
          },
        );

        console.log(
          '[document_assistant_tool] Sub-thread:',
          subThreadId,
          isNew ? '(new)' : '(reused)',
        );

        // Build additional context for the agent
        const additionalContext: Record<string, string> = {};
        if (args.fileId) {
          additionalContext.file_id = args.fileId;
        }
        if (args.fileUrl) {
          additionalContext.file_url = args.fileUrl;
        }
        if (args.fileName) {
          additionalContext.file_name = args.fileName;
        }

        // Call the Document Agent via Convex API - all context management happens inside
        const result = await ctx.runAction(
          getDocumentAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            taskDescription: args.userRequest,
            additionalContext:
              Object.keys(additionalContext).length > 0
                ? additionalContext
                : undefined,
            parentThreadId: threadId,
          },
        );

        return {
          success: true,
          response: result.text,
          usage: result.usage,
        };
      } catch (error) {
        console.error('[document_assistant_tool] Error:', error);
        return {
          success: false,
          response: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
