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

import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import type { ToolDefinition } from '../types';

/**
 * Models occasionally emit nested array elements as JSON-encoded STRINGS
 * instead of objects (`fields: ["{\"label\":...,\"type\":\"yes_no\"}"]`),
 * which fails input validation before the tool ever executes — the turn then
 * halts with no card on screen. Parse such strings back into objects/arrays
 * before validation; anything else passes through and fails with the normal
 * zod error. This is transparent to the model-facing JSON schema:
 * `toJSONSchema(..., { io: 'input' })` renders the inner schema unchanged.
 */
const coerceJsonObjectString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : value;
  } catch {
    return value;
  }
};

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

const coercedOptionSchema = z.preprocess(coerceJsonObjectString, optionSchema);

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

const todoItemInputSchema = z.object({
  id: z.string().min(1).max(80),
  content: z.string().min(1).max(500),
});

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
      .array(coercedOptionSchema)
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
      .array(coercedOptionSchema)
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
  z.object({
    ...sharedFieldProps,
    type: z
      .literal('todo_list')
      .describe(
        'Editable checklist of todo items. Renders as rows the user can add / edit / remove before confirming. Response is a JSON-stringified array of `{id, content}` objects.',
      ),
    initialTodos: z
      .array(z.preprocess(coerceJsonObjectString, todoItemInputSchema))
      .optional()
      .describe(
        'Pre-filled todos for the user to review/edit. IDs should be stable short slugs (e.g. q1, q2).',
      ),
    minItems: z.number().int().min(0).optional(),
    maxItems: z.number().int().min(1).optional(),
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

export const requestHumanInputArgs = z.object({
  // `question` is declared FIRST and described as REQUIRED so the model never
  // omits it. Previously the optional `context` came first and `question` read
  // as auxiliary, producing calls with no `question` that failed validation.
  question: z
    .string()
    .describe(
      'REQUIRED. The primary question or heading shown above the form fields — ALWAYS include this string (e.g., "Please provide the following details for the purchase contract"). It is the main prompt; `context` is only optional supporting detail and is NOT a substitute for `question`.',
    ),
  fields: z
    .preprocess(
      coerceJsonObjectString,
      z.array(z.preprocess(coerceJsonObjectString, fieldSchema)).min(1),
    )
    .describe(
      'REQUIRED. Form fields to display (at least one). Each field gets its own labeled input. Use unique labels — they serve as keys in the response.',
    ),
  ...contextField,
});

export const requestHumanInputTool = {
  name: 'request_human_input' as const,
  // primary-only: Resume targets the PRIMARY agent — a job holding it would strand an unanswerable card.
  availability: 'primary-only' as const,
  tool: createTool({
    description: `**DIRECTLY call this tool** to ask the user a question and collect their response in the current chat.

**MANDATORY — the ONLY way to collect user input:** whenever you need ANY information, confirmation, decision, clarification, missing value, preference, or disambiguation from the user, you MUST call this tool — the user CANNOT reply to plain text in your response. NEVER present options/choices as plain text or numbered lists — always this tool, so the user can interactively select. Do NOT delegate it, show JSON examples, or describe the card — calling it renders an interactive input card immediately.

**DISAMBIGUATION — multiple matches from a search:** never proceed with all matches or pick one arbitrarily. Call this tool with a single_select whose options carry distinguishing details (name, email, status), then STOP immediately — say you found N candidates and are waiting for their selection.

**HOW IT WORKS:** every call MUST include a top-level \`question\` (the heading shown above the inputs) AND \`fields\` (≥1); \`context\` is optional supporting detail, never a replacement for \`question\`. Field types: text · textarea · number / email / url / tel · single_select (ONE option, radio) · multi_select (one or more, checkboxes) · yes_no (binary confirmation). Select options must resolve to unique values — similar labels need explicit distinct \`value\` fields.

Example: question: "Which meal would you like?" · fields: [{ label: "Meal choice", type: "single_select", options: [{ label: "Creamy Garlic Pasta", description: "Italian comfort food" }, { label: "Thai Coconut Curry" }] }]

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
            // oxlint-disable-next-line oxc/no-map-spread -- immutable transform
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
              ...(f.type === 'todo_list'
                ? {
                    initialTodos: f.initialTodos,
                    minItems: f.minItems,
                    maxItems: f.maxItems,
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
