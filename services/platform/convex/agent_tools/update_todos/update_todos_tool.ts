/**
 * Convex Tool: update_todos
 *
 * Lets the agent maintain a dynamic task list rendered live in the chat UI.
 * Modeled on Claude Code's TodoWrite / LangChain deepagents' write_todos.
 *
 * Invariants enforced server-side in the mutation (not the prompt):
 * - Single-active-todo: at most one todo in `in_progress` at a time.
 * - Idempotency: duplicate `opId` batches are no-ops.
 * - Batch atomicity: all operations in one call succeed or none.
 *
 * Returned state includes the full todos array + activeTodoId so the LLM
 * sees authoritative state after every mutation.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { containsSuspiciousInjection } from '../../lib/untrusted_content';
import {
  formatTodosForPrompt,
  type TodoItem,
} from '../../thread_todos/helpers';
import type { ToolDefinition } from '../types';

const todoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'done',
  'failed',
  'cancelled',
]);

const addOperationSchema = z.object({
  type: z.literal('add'),
  id: z
    .string()
    .min(1)
    .max(80)
    .describe(
      'Stable short identifier for the todo (e.g. "q1"). Must be unique within the thread.',
    ),
  content: z
    .string()
    .min(1)
    .max(500)
    .describe('Short task description. 1 sentence is ideal.'),
});

const updateOperationSchema = z.object({
  type: z.literal('update'),
  id: z.string().min(1).max(80),
  content: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Replace content — use to record findingsSummary-style progress notes if the status is not yet done.',
    ),
  status: todoStatusSchema.optional(),
  findingsSummary: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Required when transitioning to status="done". One-line summary of what was found + source URLs if applicable.',
    ),
  failureReason: z
    .string()
    .max(500)
    .optional()
    .describe('Set when transitioning to status="failed".'),
});

const removeOperationSchema = z.object({
  type: z.literal('remove'),
  id: z.string().min(1).max(80),
});

const operationSchema = z.discriminatedUnion('type', [
  addOperationSchema,
  updateOperationSchema,
  removeOperationSchema,
]);

const updateTodosArgs = z.object({
  opId: z
    .string()
    .min(8)
    .max(128)
    .describe(
      'Idempotency key for this batch. A duplicate call with the same opId is a no-op.',
    ),
  operations: z
    .array(operationSchema)
    .min(1)
    .max(16)
    .describe(
      'Batch of operations to apply atomically. Either all succeed or none do.',
    ),
});

export const updateTodosTool = {
  name: 'update_todos' as const,
  tool: createTool({
    description: `**update_todos** — maintain a live task list for multi-step work.

USE THIS TOOL for any task requiring 3+ coordinated steps. The todo list is user-visible in the chat — every operation updates the UI in real time.

**OPERATIONS:**
- \`add\`: create a new todo in status "pending". Requires stable short \`id\`.
- \`update\`: change content/status/notes. Valid statuses: pending, in_progress, done, failed, cancelled. When transitioning to "done", set \`findingsSummary\`. When transitioning to "failed", set \`failureReason\`.
- \`remove\`: delete a todo by id (rarely needed — prefer status "cancelled").

**INVARIANTS (enforced by the system):**
- At most ONE todo may be \`in_progress\` at a time. Setting a second to in_progress will error; mark the previous done/pending first.
- \`opId\` deduplicates batches — always pass a fresh UUID per call.
- All operations in a single call are atomic.

**WORKFLOW:**
1. At the start of a task, call with add operations to seed 3–7 todos.
2. Before working on a todo, transition it to \`in_progress\`.
3. When done, transition to \`done\` with a \`findingsSummary\` that records the key insight + source URLs.
4. If a todo proves impossible, transition to \`failed\` with \`failureReason\`.
5. As findings reveal new sub-questions, call \`add\` mid-task.

**EXAMPLE (seed):**
- operations: [
    {type: "add", id: "q1", content: "Summarize Hikvision product line"},
    {type: "add", id: "q2", content: "Identify top 3 competitors"},
    {type: "add", id: "q3", content: "Check export-control status"}
  ]

**EXAMPLE (start + finish one todo):**
- operations: [
    {type: "update", id: "q1", status: "in_progress"}
  ]
  ... then after searching ...
- operations: [
    {type: "update", id: "q1", status: "done", findingsSummary: "Product line: 8 categories incl. DVR, NVR, cameras. [hikvision.com/products]"}
  ]

**RESPONSE:** returns the full current todos + activeTodoId so you always see authoritative state.`,
    inputSchema: updateTodosArgs,
    execute: async (ctx: ToolCtx, args): Promise<UpdateTodosToolResult> => {
      const { organizationId, threadId } = ctx;
      if (!organizationId) {
        return {
          success: false,
          message:
            'update_todos requires an organizationId in the tool context.',
        };
      }
      if (!threadId) {
        return {
          success: false,
          message: 'update_todos requires a threadId in the tool context.',
        };
      }

      for (const op of args.operations) {
        if (op.type === 'add' && containsSuspiciousInjection(op.content)) {
          return {
            success: false,
            message: `Refusing to add todo "${op.id}": content looks like a prompt-injection payload. Rephrase in plain language.`,
          };
        }
        if (
          op.type === 'update' &&
          op.content !== undefined &&
          containsSuspiciousInjection(op.content)
        ) {
          return {
            success: false,
            message: `Refusing to update todo "${op.id}": content looks like a prompt-injection payload. Rephrase in plain language.`,
          };
        }
      }

      const result = await ctx.runMutation(
        internal.thread_todos.internal_mutations.applyTodoOperations,
        {
          organizationId,
          threadId,
          opId: args.opId,
          operations: args.operations,
        },
      );

      if (!result.success) {
        return {
          success: false,
          message: `update_todos rejected (${result.code}): ${result.error}`,
        };
      }

      const { todos, activeTodoId, deduplicated } = result;

      return {
        success: true,
        deduplicated: deduplicated === true,
        todos,
        activeTodoId,
        summary: formatTodosForPrompt(todos),
        message: deduplicated
          ? 'Duplicate opId — returning current state unchanged.'
          : `Applied ${args.operations.length} op(s). Active todo: ${activeTodoId ?? 'none'}.`,
      };
    },
  }),
} as const satisfies ToolDefinition;

type UpdateTodosToolResult =
  | {
      success: true;
      deduplicated: boolean;
      todos: TodoItem[];
      activeTodoId?: string;
      summary: string;
      message: string;
    }
  | {
      success: false;
      message: string;
    };
