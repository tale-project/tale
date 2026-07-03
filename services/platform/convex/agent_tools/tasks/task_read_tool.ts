/**
 * Convex Tool: Task Read
 *
 * Read-only task operations for agents, scoped to the agent's organization.
 * - 'get_by_id': fetch a single task
 * - 'list': list tasks (optionally filtered by project/status/assignee)
 * - 'list_assigned_to_me': tasks assigned to the calling agent
 * - 'list_comments': comments on a task
 *
 * Mirrors the `customer_read` discriminated-union pattern.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { requireOrganizationId, resolveActorId } from './helpers/context';

const taskReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_by_id'),
    taskId: z.string().describe('Convex Id<"tasks"> of the target task'),
  }),
  z.object({
    operation: z.literal('list'),
    projectId: z
      .string()
      .optional()
      .describe('Optional Convex Id<"projects"> to scope the list to'),
    status: z
      .enum([
        'backlog',
        'todo',
        'in_progress',
        'in_review',
        'done',
        'cancelled',
      ])
      .optional()
      .describe('Optional status filter'),
    assigneeId: z
      .string()
      .optional()
      .describe('Optional assignee id (userId or agent slug) to filter by'),
  }),
  z.object({
    operation: z.literal('list_assigned_to_me'),
  }),
  z.object({
    operation: z.literal('list_comments'),
    taskId: z.string().describe('Convex Id<"tasks"> of the task'),
  }),
]);

export const taskReadTool: ToolDefinition = {
  name: 'task_read',
  availability: 'any',
  tool: createTool({
    description: `Read tasks from the project task board (the shared work board for humans and agents).

OPERATIONS:
• 'get_by_id': Fetch one task by its Convex ID (title, description, status, priority, labels, assignee, parentTaskId).
• 'list': List tasks for the organization. Optionally filter by projectId, status, or assigneeId. Use this to find work to pick up.
• 'list_assigned_to_me': List tasks currently assigned to you (the calling agent).
• 'list_comments': List the comment thread on a task.

Statuses: backlog | todo | in_progress | in_review | done | cancelled.
To pick up work: list tasks (e.g. status='todo' and unassigned), then use task_write 'claim'.`,
    inputSchema: taskReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'get_by_id') {
        const task = await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: toId<'tasks'>(args.taskId), organizationId },
        );
        return { operation: 'get_by_id', task };
      }

      if (args.operation === 'list_comments') {
        const comments = await ctx.runQuery(
          internal.tasks.internal_queries.listTaskDiscussionMessagesInternal,
          { taskId: toId<'tasks'>(args.taskId), organizationId },
        );
        return { operation: 'list_comments', comments };
      }

      if (args.operation === 'list_assigned_to_me') {
        const tasks = await ctx.runQuery(
          internal.tasks.internal_queries.listTasksForAgent,
          {
            organizationId,
            assigneeType: 'agent',
            assigneeId: resolveActorId(ctx),
          },
        );
        return { operation: 'list_assigned_to_me', tasks };
      }

      // operation === 'list'
      const tasks = await ctx.runQuery(
        internal.tasks.internal_queries.listTasksForAgent,
        {
          organizationId,
          projectId: args.projectId
            ? toId<'projects'>(args.projectId)
            : undefined,
          status: args.status,
          assigneeId: args.assigneeId,
        },
      );
      return { operation: 'list', tasks };
    },
  }),
} as const;
