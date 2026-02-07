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
import { internal } from '../../_generated/api';

const DOCUMENT_CONTEXT_MAPPING = {
  fileId: 'file_id',
  fileUrl: 'file_url',
  fileName: 'file_name',
} as const;

export const documentAssistantTool = {
  name: 'document_assistant' as const,
  tool: createTool({
    description: `Delegate document-related tasks to the specialized Document Agent.

CAPABILITIES:
• Parse documents: PDF, Word (.docx), PowerPoint (.pptx), text files (requires fileId)
• Analyze images using vision model (requires fileId)
• Generate files: PDF from Markdown/HTML, Excel spreadsheets, Word/PowerPoint from templates
• Multi-step document workflows

⚠️ PRE-ANALYZED CONTENT CHECK:
If the CURRENT message contains "[PRE-ANALYZED CONTENT" or sections like "**Document:**", "**Image:**", "**Text File:**", answer directly from that content WITHOUT calling this tool.

WHEN TO USE THIS TOOL:
• Multi-turn conversations: User asks follow-up questions about a file uploaded in a PREVIOUS message
• File generation: Creating new PDF, Excel, Word, or PowerPoint files
• Re-analysis: User wants deeper analysis or different perspective on a document
• Complex queries: Multi-step document processing workflows

EXAMPLES:
• Parse PDF: { userRequest: "Summarize the key findings in this PDF", fileId: "kg2bazp7...", fileName: "report.pdf" }
• Parse DOCX: { userRequest: "Extract all action items from this document", fileId: "kg2bazp7...", fileName: "meeting.docx" }
• Analyze image: { userRequest: "What products are shown in this image?", fileId: "kg2bazp7..." }
• Generate PDF: { userRequest: "Create a PDF report with this data: ..." }
• Create Excel: { userRequest: "Generate an Excel file with these columns: Name, Email, Status" }
• Follow-up query: { userRequest: "Find all dates mentioned in that document I uploaded earlier" }`,

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
          internal.agents.document.internal_actions.generateResponse,
          {
            threadId: subThreadId,
            userId,
            organizationId,
            promptMessage: args.userRequest,
            additionalContext: buildAdditionalContext(
              args,
              DOCUMENT_CONTEXT_MAPPING,
            ),
            parentThreadId: threadId,
          },
        );

        return successResponse(
          result.text,
          {
            ...result.usage,
            durationSeconds:
              result.durationMs !== undefined
                ? result.durationMs / 1000
                : undefined,
          },
          result.model,
          result.provider,
          undefined,
          args.userRequest,
        );
      } catch (error) {
        return handleToolError('document_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
