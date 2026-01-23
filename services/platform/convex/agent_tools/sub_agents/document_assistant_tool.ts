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
import { validateToolContext } from './helpers/validate_context';
import { buildAdditionalContext } from './helpers/build_additional_context';
import {
  successResponse,
  handleToolError,
  type ToolResponse,
} from './helpers/tool_response';
import { getDocumentAgentGenerateResponseRef } from '../../lib/function_refs';

const DOCUMENT_CONTEXT_MAPPING = {
  fileId: 'file_id',
  fileUrl: 'file_url',
  fileName: 'file_name',
} as const;

export const documentAssistantTool = {
  name: 'document_assistant' as const,
  tool: createTool({
    description: `Delegate document-related tasks to the specialized Document Agent.

Use this tool for ANY document-related request, including:
- Parsing uploaded PDF, Word, PowerPoint, or TXT files
- Generating PDF documents from Markdown/HTML
- Creating Excel files from structured data
- Analyzing images using vision capabilities
- Analyzing text/log files

The Document Agent is specialized in:
- Extracting text and structure from documents
- Analyzing text files (TXT, LOG) with AI
- Generating downloadable files (PDF, Excel)
- Image analysis with vision model
- Multi-step document workflows

Simply describe what you need done with the document.

EXAMPLES:
• Parse PDF: { userRequest: "Extract the content from this PDF", fileUrl: "https://...", fileName: "report.pdf" }
• Analyze TXT: { userRequest: "Find all error messages in this log", fileId: "kg2bazp7...", fileName: "app.log" }
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
        .describe('Convex storage ID for uploaded files (for image analysis or text file analysis)'),
      fileUrl: z
        .string()
        .optional()
        .describe('URL of the file to process (for parsing documents)'),
      fileName: z
        .string()
        .optional()
        .describe('Original filename (e.g., "report.pdf")'),
    }),

    handler: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
      const validation = validateToolContext(ctx, 'document_assistant');
      if (!validation.valid) return validation.error;

      const { organizationId, threadId, userId } = validation.context;

      try {
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

        const result = await ctx.runAction(
          getDocumentAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            taskDescription: args.userRequest,
            additionalContext: buildAdditionalContext(
              args,
              DOCUMENT_CONTEXT_MAPPING,
            ),
            parentThreadId: threadId,
          },
        );

        return successResponse(result.text, result.usage);
      } catch (error) {
        return handleToolError('document_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
