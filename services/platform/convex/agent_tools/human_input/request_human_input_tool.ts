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

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

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

const baseFields = {
  question: z
    .string()
    .describe('The question to ask the user. Be clear and specific.'),
  context: z
    .string()
    .optional()
    .describe(
      'Optional context to help the user understand why you are asking.',
    ),
};

const requestHumanInputArgs = z.discriminatedUnion('format', [
  z.object({
    ...baseFields,
    format: z.literal('single_select'),
    options: z
      .array(optionSchema)
      .min(2)
      .describe('Options for the user to choose from. At least 2 required.'),
  }),
  z.object({
    ...baseFields,
    format: z.literal('multi_select'),
    options: z
      .array(optionSchema)
      .min(2)
      .describe('Options for the user to choose from. At least 2 required.'),
  }),
  z.object({
    ...baseFields,
    format: z.literal('text_input'),
    placeholder: z
      .string()
      .optional()
      .describe('Placeholder text for the text input field.'),
  }),
  z.object({
    ...baseFields,
    format: z.literal('yes_no'),
    options: z
      .array(optionSchema)
      .length(2)
      .optional()
      .describe(
        'Custom Yes/No options. Must be exactly 2 if provided. Defaults to [Yes, No] if omitted.',
      ),
  }),
]);

export const requestHumanInputTool = {
  name: 'request_human_input' as const,
  tool: createTool({
    description: `**DIRECTLY call this tool** to ask the user a question and collect their response in the current chat.

**IMPORTANT - DIRECT TOOL CALL:**
• This is a DIRECT tool call - do NOT delegate to other agents to create human input requests
• When you call this tool, an interactive input card will IMMEDIATELY appear in the chat UI
• The user can respond by clicking options or typing text directly in the chat
• Do NOT show JSON examples or code snippets - just call this tool directly
• NEVER present options/choices as plain text — always use this tool so the user can interactively select
• Do NOT include "Something else", "Other", or similar fallback options — the UI automatically adds a "Something else" option with a text input to all select-type cards

**WHEN TO USE:**
• When presenting multiple options, suggestions, or recommendations for the user to choose from (e.g., "3 meal options", "which plan?", "here are some alternatives")
• ANY time your response would list numbered/bulleted choices — use this tool instead of plain text
• When you encounter multiple valid options and need user to decide (e.g., "Found 3 matching contacts, which one?")
• To clarify ambiguous requirements before proceeding
• To get user confirmation for important or destructive actions (e.g., "Confirm deletion?")
• To collect user preferences when the task cannot proceed without their input

**INPUT FORMATS:**
• single_select: User picks ONE option from a list (mutually exclusive choices)
• multi_select: User picks ONE OR MORE options (non-exclusive selections)
• text_input: User types free-form text (open-ended questions)
• yes_no: User confirms or denies (binary decisions, auto-generates Yes/No options)

**EXAMPLE - When generating options/suggestions for the user:**
Call this tool with:
- question: "Here are 3 meal options for you. Which one would you like?"
- format: "single_select"
- options: [{ label: "Creamy Garlic Parmesan Pasta", description: "Italian comfort food with cream sauce" }, { label: "Mediterranean Grain Bowl", description: "Fresh quinoa bowl with veggies and tzatziki" }, { label: "Thai Coconut Curry", description: "Aromatic curry with rice" }]

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
    args: requestHumanInputArgs,
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
      const { organizationId, threadId: currentThreadId } = ctx;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflow context fields spread onto ctx at runtime via execute_agent_with_tools.ts
      const ctxRecord = ctx as unknown as Record<string, unknown>;
      const wfExecutionId =
        typeof ctxRecord.wfExecutionId === 'string'
          ? ctxRecord.wfExecutionId
          : undefined;
      const stepSlug =
        typeof ctxRecord.stepSlug === 'string' ? ctxRecord.stepSlug : undefined;

      // Look up parent thread from thread summary (stable, database-backed)
      // This ensures approvals from sub-agents link to the main chat thread
      const threadId = await getApprovalThreadId(ctx, currentThreadId);

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

      // Resolve options: select formats carry them in args; yes_no defaults to Yes/No
      const options =
        'options' in args && args.options
          ? args.options
          : args.format === 'yes_no'
            ? [
                { label: 'Yes', value: 'yes' },
                { label: 'No', value: 'no' },
              ]
            : undefined;

      try {
        const requestId = await ctx.runMutation(
          internal.agent_tools.human_input.internal_mutations
            .createHumanInputRequest,
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
            placeholder: 'placeholder' in args ? args.placeholder : undefined,
            wfExecutionId,
            stepSlug,
          },
        );

        return {
          success: true,
          requestId,
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
