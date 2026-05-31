/**
 * Task-specific workflow action.
 *
 * Lets automations create and update tasks on the board (e.g. "GitHub issue →
 * triaged task", "notify on status change"). Reads `organizationId` from
 * workflow context variables and dispatches to the agent-facing internal task
 * mutations, attributing the change to a `workflow` actor.
 *
 * Mirrors `customer_action.ts`.
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import {
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from '../../../tasks/schema';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

const WORKFLOW_ACTOR_ID = 'workflow';

type TaskActionParams =
  | {
      operation: 'create';
      projectId: string;
      title: string;
      description?: string;
      status?:
        | 'backlog'
        | 'todo'
        | 'in_progress'
        | 'in_review'
        | 'done'
        | 'cancelled';
      priority?: 'p0' | 'p1' | 'p2' | 'p3';
      labels?: string[];
      parentTaskId?: string;
    }
  | {
      operation: 'update_status';
      taskId: string;
      status:
        | 'backlog'
        | 'todo'
        | 'in_progress'
        | 'in_review'
        | 'done'
        | 'cancelled';
    }
  | {
      operation: 'assign';
      taskId: string;
      assigneeType?: 'user' | 'agent';
      assigneeId?: string;
    }
  | {
      operation: 'comment';
      taskId: string;
      body: string;
    }
  | {
      operation: 'upsert_external';
      projectId: string;
      externalSystem: string;
      externalId: string;
      title: string;
      externalUrl?: string;
      description?: string;
      labels?: string[];
      priority?: 'p0' | 'p1' | 'p2' | 'p3';
      externalState?: 'open' | 'closed';
    };

export const taskAction: ActionDefinition<TaskActionParams> = {
  type: 'task',
  title: 'Task Operation',
  description:
    'Create or update tasks on the project board (create, update_status, assign, comment, upsert_external). upsert_external idempotently links an external item (e.g. a GitHub issue) to a task by (externalSystem, externalId) — used by integration-sync automations. organizationId is read from workflow context variables.',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('create'),
      projectId: v.id('projects'),
      title: v.string(),
      description: v.optional(v.string()),
      status: v.optional(taskStatusValidator),
      priority: v.optional(taskPriorityValidator),
      labels: v.optional(v.array(v.string())),
      parentTaskId: v.optional(v.id('tasks')),
    }),
    v.object({
      operation: v.literal('update_status'),
      taskId: v.id('tasks'),
      status: taskStatusValidator,
    }),
    v.object({
      operation: v.literal('assign'),
      taskId: v.id('tasks'),
      assigneeType: v.optional(taskActorTypeValidator),
      assigneeId: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('comment'),
      taskId: v.id('tasks'),
      body: v.string(),
    }),
    v.object({
      operation: v.literal('upsert_external'),
      projectId: v.id('projects'),
      externalSystem: v.string(),
      externalId: v.string(),
      title: v.string(),
      externalUrl: v.optional(v.string()),
      description: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
      priority: v.optional(taskPriorityValidator),
      externalState: v.optional(
        v.union(v.literal('open'), v.literal('closed')),
      ),
    }),
  ),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'task action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentCreateTask,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            projectId: toId<'projects'>(params.projectId),
            title: params.title,
            description: params.description,
            status: params.status,
            priority: params.priority,
            labels: params.labels,
            parentTaskId: params.parentTaskId
              ? toId<'tasks'>(params.parentTaskId)
              : undefined,
          },
        );
        return await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: result.taskId, organizationId },
        );
      }

      case 'update_status': {
        return await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpdateTaskStatus,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
            status: params.status,
          },
        );
      }

      case 'assign': {
        return await ctx.runMutation(
          internal.tasks.internal_mutations.agentAssignTask,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
            assigneeType: params.assigneeType,
            assigneeId: params.assigneeId,
          },
        );
      }

      case 'comment': {
        return await ctx.runMutation(
          internal.tasks.internal_mutations.agentAddComment,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
            body: params.body,
          },
        );
      }

      case 'upsert_external': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            projectId: toId<'projects'>(params.projectId),
            externalSystem: params.externalSystem,
            externalId: params.externalId,
            title: params.title,
            externalUrl: params.externalUrl,
            description: params.description,
            labels: params.labels,
            priority: params.priority,
            externalState: params.externalState,
          },
        );
        const task = await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: result.taskId, organizationId },
        );
        return { task, created: result.created };
      }

      default: {
        // Exhaustiveness: if a new operation is added to the union without a
        // case above, this assignment fails to compile.
        const unhandled: never = params;
        throw new Error(
          `Unsupported task operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
