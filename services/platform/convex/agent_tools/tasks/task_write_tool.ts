/**
 * Convex Tool: Task Write
 *
 * Lets an agent create tasks, pick up work (atomic claim), move tasks across
 * the board, (re)assign, and comment. All writes go through
 * `tasks/internal_mutations.ts`, which re-enforces organization isolation and
 * attributes the change to the agent. Destructive delete is intentionally NOT
 * exposed here (admin-only, approval-gated — a later milestone).
 *
 * `claim` surfaces a lost race as a structured `{ claimed: false }` result, not
 * an error, so the agent can move on to another task.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { requireOrganizationId, resolveActorId } from './helpers/context';

const STATUS = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
]);
const PRIORITY = z.enum(['p0', 'p1', 'p2', 'p3']);

const taskWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    projectId: z.string().describe('Convex Id<"projects"> the task belongs to'),
    title: z.string().describe('Short task title'),
    description: z.string().optional().describe('Optional task description'),
    status: STATUS.optional().describe('Initial status (default: backlog)'),
    priority: PRIORITY.optional(),
    labels: z.array(z.string()).optional(),
    parentTaskId: z
      .string()
      .optional()
      .describe('Optional Convex Id<"tasks"> to create this as a subtask'),
  }),
  z.object({
    operation: z.literal('update_status'),
    taskId: z.string(),
    status: STATUS,
  }),
  z.object({
    operation: z.literal('claim'),
    taskId: z.string().describe('Task to pick up (assign to yourself)'),
  }),
  z.object({
    operation: z.literal('assign'),
    taskId: z.string(),
    assigneeType: z
      .enum(['user', 'agent'])
      .optional()
      .describe('Omit both assignee fields to unassign'),
    assigneeId: z.string().optional(),
  }),
  z.object({
    operation: z.literal('comment'),
    taskId: z.string(),
    body: z.string().describe('Plain-text comment. Use @handle to mention.'),
  }),
]);

export const taskWriteTool: ToolDefinition = {
  name: 'task_write',
  tool: createTool({
    description: `Create and update tasks on the project task board.

OPERATIONS:
• 'create': Create a task in a project (optionally as a subtask via parentTaskId).
• 'claim': Pick up a task — atomically assign it to yourself. Returns { claimed: false, reason: 'ALREADY_CLAIMED' } if another actor already took it; move on to another task in that case.
• 'update_status': Move a task across the board (backlog→todo→in_progress→in_review→done, or cancelled). A parent task cannot be moved to done/cancelled while it has open subtasks (returns reason 'TASK_HAS_OPEN_SUBTASKS').
• 'assign': Set or clear the single assignee (a user or an agent). Omit both fields to unassign.
• 'comment': Add a plain-text comment; @mention a teammate or agent by handle.

Typical loop: task_read 'list' to find unassigned work → 'claim' it → 'update_status' to in_progress → do the work → 'comment' with results → 'update_status' to in_review/done.`,
    inputSchema: taskWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);
      const actorId = resolveActorId(ctx);

      if (args.operation === 'create') {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentCreateTask,
          {
            organizationId,
            actorId,
            projectId: toId<'projects'>(args.projectId),
            title: args.title,
            description: args.description,
            status: args.status,
            priority: args.priority,
            labels: args.labels,
            parentTaskId: args.parentTaskId
              ? toId<'tasks'>(args.parentTaskId)
              : undefined,
          },
        );
        return { operation: 'create', ...result };
      }

      if (args.operation === 'update_status') {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpdateTaskStatus,
          {
            organizationId,
            actorId,
            taskId: toId<'tasks'>(args.taskId),
            status: args.status,
          },
        );
        return { operation: 'update_status', ...result };
      }

      if (args.operation === 'claim') {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentClaimTask,
          { organizationId, actorId, taskId: toId<'tasks'>(args.taskId) },
        );
        return { operation: 'claim', ...result };
      }

      if (args.operation === 'assign') {
        // Both-or-none: a discriminatedUnion member can't carry a Zod
        // `.refine`, so guard the half-specified LLM payload here instead.
        if (
          (args.assigneeType === undefined) !==
          (args.assigneeId === undefined)
        ) {
          return {
            operation: 'assign',
            assigned: false,
            reason:
              'Provide both assigneeType and assigneeId, or omit both to unassign.',
          };
        }
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentAssignTask,
          {
            organizationId,
            actorId,
            taskId: toId<'tasks'>(args.taskId),
            assigneeType: args.assigneeType,
            assigneeId: args.assigneeId,
          },
        );
        return { operation: 'assign', ...result };
      }

      // operation === 'comment'
      const result = await ctx.runMutation(
        internal.tasks.internal_mutations.agentAddComment,
        {
          organizationId,
          actorId,
          taskId: toId<'tasks'>(args.taskId),
          body: args.body,
        },
      );
      return { operation: 'comment', ...result };
    },
  }),
} as const;
