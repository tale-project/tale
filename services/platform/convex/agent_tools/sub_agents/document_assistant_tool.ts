/**
 * Document Assistant Tool
 *
 * Delegates document-related tasks to the specialized Document Assistant Agent.
 * Isolates large document content from the main chat agent's context.
 *
 * Uses the shared context management module for:
 * - Structured prompt building
 * - Smart history filtering via contextHandler
 * - Token-aware context management
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createDocumentAgent } from '../../lib/create_document_agent';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { buildSubAgentPrompt } from './helpers/build_sub_agent_prompt';
import { createContextHandler, AGENT_CONTEXT_CONFIGS } from '../../lib/context_management';

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

      // Sub-thread creation requires a parent threadId to link to
      if (!threadId) {
        return {
          success: false,
          response: '',
          error: 'threadId is required for document_assistant to create sub-threads',
        };
      }

      try {
        const documentAgent = createDocumentAgent();

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'document_assistant',
            userId,
          },
        );

        console.log('[document_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');

        // Build structured prompt using the shared context management module
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

        const promptResult = buildSubAgentPrompt({
          userRequest: args.userRequest,
          agentType: 'document',
          threadId: subThreadId,
          organizationId,
          userId,
          parentThreadId: threadId,
          additionalContext,
        });

        console.log('[document_assistant_tool] Calling documentAgent.generateText', {
          estimatedTokens: promptResult.estimatedTokens,
        });

        // Create context handler with document agent configuration
        const documentConfig = AGENT_CONTEXT_CONFIGS.document;
        const contextHandler = createContextHandler({
          modelContextLimit: documentConfig.modelContextLimit,
          outputReserve: documentConfig.outputReserve,
          minRecentMessages: Math.min(4, documentConfig.recentMessages),
        });

        const generationStartTime = Date.now();
        const result = await documentAgent.generateText(
          ctx,
          { threadId: subThreadId, userId },
          {
            prompt: promptResult.prompt,
            messages: promptResult.systemMessages,
          },
          {
            contextOptions: {
              recentMessages: documentConfig.recentMessages,
              excludeToolMessages: false,
            },
            contextHandler,
          },
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
