/**
 * Convex Tool: Request Human Input
 *
 * Allows the AI to ask the user a question and receive a response.
 * Uses a unified form model where each question is a field with its own type.
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
    .describe(
      'Optional value to return (defaults to label if not provided). When multiple options share similar labels, provide explicit distinct values to avoid ambiguity.',
    ),
});

const uniqueOptionValues = (options: z.output<typeof optionSchema>[]) => {
  const values = options.map((opt) => opt.value ?? opt.label);
  return new Set(values).size === values.length;
};

const sharedFieldProps = {
  label: z
    .string()
    .describe(
      'Display label for the field. Must be unique across all fields — used as the key in the response.',
    ),
  description: z
    .string()
    .optional()
    .describe('Help text shown below the field label.'),
  required: z
    .boolean()
    .optional()
    .describe('Whether the field must be filled. Defaults to false.'),
};

const fieldSchema = z.discriminatedUnion('type', [
  z.object({
    ...sharedFieldProps,
    type: z
      .enum(['text', 'textarea', 'number', 'email', 'url', 'tel'])
      .describe(
        'Input type. Use "text" for short single-line input, "textarea" for longer multi-line input, or a specialized type for validation.',
      ),
  }),
  z.object({
    ...sharedFieldProps,
    type: z
      .enum(['single_select', 'multi_select'])
      .describe(
        'Use "single_select" when the user picks ONE option, "multi_select" when the user picks ONE OR MORE.',
      ),
    options: z
      .array(optionSchema)
      .min(2)
      .refine(uniqueOptionValues, {
        message:
          'Each option must have a unique resolved value (value ?? label). Use explicit "value" fields to distinguish options with similar labels.',
      })
      .describe('Options for the user to choose from. At least 2 required.'),
  }),
  z.object({
    ...sharedFieldProps,
    type: z.literal('yes_no').describe('Binary yes/no confirmation.'),
    options: z
      .array(optionSchema)
      .length(2)
      .refine(uniqueOptionValues, {
        message:
          'Each option must have a unique resolved value (value ?? label).',
      })
      .optional()
      .describe(
        'Custom Yes/No options. Must be exactly 2 if provided. Defaults to [Yes, No] if omitted.',
      ),
  }),
]);

const contextField = {
  context: z
    .string()
    .optional()
    .describe(
      'Optional context to help the user understand why you are asking.',
    ),
};

const requestHumanInputArgs = z.object({
  ...contextField,
  question: z
    .string()
    .describe(
      'A heading or instruction shown above the form fields (e.g., "Please provide the following details for the purchase contract").',
    ),
  fields: z
    .array(fieldSchema)
    .min(1)
    .describe(
      'Form fields to display. Each field gets its own labeled input. Use unique labels — they serve as keys in the response.',
    ),
});

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

**WHEN TO USE:**
• When presenting multiple options, suggestions, or recommendations for the user to choose from
• ANY time your response would list numbered/bulleted choices — use this tool instead of plain text
• When you encounter multiple valid options and need user to decide
• To clarify ambiguous requirements before proceeding
• To get user confirmation for important or destructive actions
• To collect structured information (e.g., contract details, user profiles, configuration)

**HOW IT WORKS:**
Every request is a form with one or more fields. Each field has a type that determines how it renders:

**FIELD TYPES:**
• text: Short single-line text input
• textarea: Multi-line text input for longer content
• number / email / url / tel: Specialized text inputs
• single_select: User picks ONE option from a list (radio buttons). Each option must resolve to a unique value — if labels are similar, provide explicit distinct "value" fields.
• multi_select: User picks ONE OR MORE options (checkboxes). Same uniqueness rule as single_select.
• yes_no: Binary yes/no confirmation (defaults to Yes/No buttons)

**EXAMPLE - Single question (one select field):**
- question: "Which meal would you like?"
- fields: [{ label: "Meal choice", type: "single_select", options: [{ label: "Creamy Garlic Pasta", description: "Italian comfort food" }, { label: "Mediterranean Bowl", description: "Quinoa with veggies" }, { label: "Thai Coconut Curry", description: "Aromatic curry with rice" }] }]

**EXAMPLE - Confirmation (one yes_no field):**
- question: "Please confirm"
- fields: [{ label: "Delete these 3 records?", type: "yes_no", required: true }]

**EXAMPLE - Collecting structured information (multiple fields):**
- question: "Please provide the purchase contract details"
- fields: [{ label: "Contract date", type: "text", required: true }, { label: "Seller company name", type: "text", required: true }, { label: "Seller address", type: "textarea" }, { label: "Buyer company name", type: "text", required: true }, { label: "Buyer address", type: "textarea" }, { label: "Payment terms", type: "single_select", options: [{ label: "Net 30" }, { label: "Net 60" }, { label: "Upon delivery" }] }]

**EXAMPLE - Mixed field types:**
- question: "Configure your notification preferences"
- fields: [{ label: "Notification channels", type: "multi_select", required: true, options: [{ label: "Email" }, { label: "SMS" }, { label: "Slack" }] }, { label: "Custom webhook URL", type: "url" }, { label: "Enable daily digest?", type: "yes_no" }]

**AFTER CALLING - CRITICAL:**
• An input card appears in the user's chat interface
• You MUST STOP and produce your final response immediately
• Do NOT call any more tools or continue with any operation
• Do NOT assume or guess what the user will select
• The user's response will appear in a FUTURE turn as <human_response>
• Simply acknowledge you're waiting for their input`,
    inputSchema: requestHumanInputArgs,
    execute: async (
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

      // Resolve yes_no defaults and map fields for the mutation
      const fields = args.fields.map((f) => {
        if (f.type === 'yes_no' && !('options' in f && f.options)) {
          return {
            ...f,
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          };
        }
        return f;
      });

      try {
        const requestId = await ctx.runMutation(
          internal.agent_tools.human_input.internal_mutations
            .createHumanInputRequest,
          {
            organizationId,
            threadId,
            question: args.question,
            context: args.context,
            fields: fields.map((f) => ({
              label: f.label,
              description: f.description,
              required: f.required,
              type: f.type,
              ...('options' in f && f.options
                ? {
                    options: f.options.map((opt) => ({
                      label: opt.label,
                      description: opt.description,
                      value: opt.value,
                    })),
                  }
                : {}),
            })),
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
