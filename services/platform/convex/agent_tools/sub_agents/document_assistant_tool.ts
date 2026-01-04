/**
 * Document Assistant Tool
 *
 * Delegates document-related tasks to the specialized Document Assistant Agent.
 * Isolates large document content from the main chat agent's context.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createDocumentAgent } from '../../lib/create_document_agent';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';

export const documentAssistantTool = {
  name: 'document_assistant' as const,
  tool: createTool({
    description: `Delegate document-related tasks to the specialized Document Assistant Agent.

Use this tool for ANY document-related request, including:
- Parsing uploaded PDF, Word, or PowerPoint files
- Generating PDF documents from Markdown/HTML
- Creating Excel files from structured data
- Analyzing images using vision capabilities

The Document Assistant is specialized in:
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
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      // Agent SDK requires either userId or threadId
      if (!threadId && !userId) {
        return {
          success: false,
          response: '',
          error: 'Either threadId or userId is required',
        };
      }

      try {
        const documentAgent = createDocumentAgent();

        // Build the prompt with context
        let prompt = `## User Request:\n${args.userRequest}\n\n`;
        if (args.fileId) {
          prompt += `## File ID (for image analysis): ${args.fileId}\n\n`;
        }
        if (args.fileUrl) {
          prompt += `## File URL: ${args.fileUrl}\n\n`;
        }
        if (args.fileName) {
          prompt += `## File Name: ${args.fileName}\n\n`;
        }
        prompt += `## Context:\n`;
        prompt += `- Organization ID: ${organizationId}\n`;

        console.log('[document_assistant_tool] Calling documentAgent.generateText');

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId!,
            subAgentType: 'document_assistant',
            userId,
          },
        );

        console.log('[document_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');

        const generationStartTime = Date.now();
        const result = await documentAgent.generateText(
          ctx,
          { threadId: subThreadId, userId },
          { prompt },
        );
        const generationDurationMs = Date.now() - generationStartTime;

        console.log('[document_assistant_tool] Result:', {
          durationMs: generationDurationMs,
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
          stepsCount: result.steps?.length ?? 0,
        });

        return {
          success: true,
          response: result.text,
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
