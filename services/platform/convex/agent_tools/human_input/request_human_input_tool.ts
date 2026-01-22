/**
 * Convex Tool: Request Human Input
 *
 * Allows the AI to ask the user a question and receive a response.
 * Supports multiple input formats: single_select, multi_select, text_input, yes_no.
 *
 * The request creates an approval record that displays as an input card in the chat UI.
 * When the user responds, the response is stored and injected into the AI's context
 * as a structured <human_response> tag.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getCreateHumanInputRequestRef } from '../../lib/function_refs';

const optionSchema = z.object({
  label: z.string().describe('Display label for the option.'),
  description: z
    .string()
    .optional()
    .describe('Optional description explaining this option.'),
  value: z
    .string()
    .optional()
    .describe('Optional value to return (defaults to label if not provided).'),
});

export const requestHumanInputTool = {
  name: 'request_human_input' as const,
  tool: createTool({
    description: `**DIRECTLY call this tool** to ask the user a question and collect their response in the current chat.

**IMPORTANT - DIRECT TOOL CALL:**
• This is a DIRECT tool call - do NOT use workflow_assistant or other tools to create human input requests
• When you call this tool, an interactive input card will IMMEDIATELY appear in the chat UI
• The user can respond by clicking options or typing text directly in the chat
• Do NOT show JSON examples or code snippets - just call this tool directly

**WHEN TO USE:**
• When you encounter multiple valid options and need user to decide (e.g., "Found 3 matching contacts, which one?")
• To clarify ambiguous requirements before proceeding
• To get user confirmation for important or destructive actions (e.g., "Confirm deletion?")
• To collect user preferences when the task cannot proceed without their input

**INPUT FORMATS:**
• single_select: User picks ONE option from a list (mutually exclusive choices)
• multi_select: User picks ONE OR MORE options (non-exclusive selections)
• text_input: User types free-form text (open-ended questions)
• yes_no: User confirms or denies (binary decisions, auto-generates Yes/No options)

**EXAMPLE - When you find multiple matching records:**
Call this tool with:
- question: "Found 3 contacts matching 'John'. Which one should I use?"
- format: "single_select"
- options: [{ label: "John Smith (Sales)", value: "contact_123" }, { label: "John Doe (Support)", value: "contact_456" }]

**AFTER CALLING - CRITICAL:**
• An input card appears in the user's chat interface
• You MUST STOP and produce your final response immediately
• Do NOT call any more tools or continue with any operation
• Do NOT assume or guess what the user will select
• The user's response will appear in a FUTURE turn as <human_response>
• Simply acknowledge you're waiting for their selection`,
    args: z.object({
      question: z
        .string()
        .describe(
          'The question to ask the user. Be clear and specific.',
        ),
      format: z
        .enum(['single_select', 'multi_select', 'text_input', 'yes_no'])
        .describe('The input format for the response.'),
      context: z
        .string()
        .optional()
        .describe(
          'Optional context to help the user understand why you are asking.',
        ),
      options: z
        .array(optionSchema)
        .optional()
        .describe(
          'Options for single_select or multi_select formats. Required for select formats.',
        ),
      placeholder: z
        .string()
        .optional()
        .describe('Placeholder text for text_input format.'),
    }),
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requestId?: string;
      requestCreated?: boolean;
      waitingForUser?: boolean;
      message: string;
    }> => {
      const { organizationId, threadId: currentThreadId, parentThreadId } = ctx;
      const threadId = parentThreadId ?? currentThreadId;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to request human input.',
        };
      }

      if (!threadId) {
        return {
          success: false,
          message: 'threadId is required to request human input.',
        };
      }

      // Validate options for select formats
      if (
        (args.format === 'single_select' || args.format === 'multi_select') &&
        (!args.options || args.options.length < 2)
      ) {
        return {
          success: false,
          message: `${args.format} format requires at least 2 options.`,
        };
      }

      // For yes_no format, ensure exactly two options
      let options = args.options;
      if (args.format === 'yes_no') {
        if (options && options.length !== 2) {
          return {
            success: false,
            message: 'yes_no format requires exactly 2 options.',
          };
        }
        if (!options) {
          options = [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ];
        }
      }

      try {
        const requestId = await ctx.runMutation(
          getCreateHumanInputRequestRef(),
          {
            organizationId,
            threadId,
            question: args.question,
            format: args.format,
            context: args.context,
            options: options?.map((opt) => ({
              label: opt.label,
              description: opt.description,
              value: opt.value,
            })),
            placeholder: args.placeholder,
          },
        );

        return {
          success: true,
          requestId: requestId as string,
          requestCreated: true,
          waitingForUser: true,
          message: `STOP - WAITING FOR USER INPUT

An input card (ID: ${requestId}) has been created and is now displayed to the user.

CRITICAL: You MUST stop here and produce your final response now. Do NOT:
- Call any more tools
- Make assumptions about what the user will select
- Generate a fake <human_response>
- Continue with any operation

The user's actual response will appear in a FUTURE conversation turn as <human_response id="${requestId}">. You will NOT see it in this turn.

Your response now should acknowledge that you're waiting for the user to make their selection.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create human input request: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
