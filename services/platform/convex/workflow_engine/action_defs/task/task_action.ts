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
      operation: 'sweep';
      kind: 'stale' | 'due_soon' | 'overdue_ladder' | 'archivable';
      staleAfterHours?: number;
      windowHours?: number;
      managerEscalationHours?: number;
      adminEscalationHours?: number;
      olderThanDays?: number;
      limit?: number;
    }
  | {
      operation: 'get';
      taskId: string;
    }
  | {
      operation: 'subtask_progress';
      taskId: string;
    }
  | {
      operation: 'list_dependents';
      taskId: string;
    }
  | {
      operation: 'list_open_for_assignee';
      assigneeType: 'user' | 'agent';
      assigneeId: string;
    }
  | {
      operation: 'archive';
      taskId: string;
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
    'Create, read, and update tasks on the project board (create, get, update_status, assign, comment, archive, subtask_progress, list_dependents, list_open_for_assignee, upsert_external) plus the pack maintenance sweeps (sweep kinds: stale, due_soon, overdue_ladder, archivable — atomic mark-and-return, safe under repeated crons). upsert_external idempotently links an external item (e.g. a GitHub issue) to a task by (externalSystem, externalId). organizationId is read from workflow context variables.',
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
      operation: v.literal('sweep'),
      kind: v.union(
        v.literal('stale'),
        v.literal('due_soon'),
        v.literal('overdue_ladder'),
        v.literal('archivable'),
      ),
      staleAfterHours: v.optional(v.number()),
      windowHours: v.optional(v.number()),
      managerEscalationHours: v.optional(v.number()),
      adminEscalationHours: v.optional(v.number()),
      olderThanDays: v.optional(v.number()),
      limit: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('get'),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('subtask_progress'),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('list_dependents'),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('list_open_for_assignee'),
      assigneeType: taskActorTypeValidator,
      assigneeId: v.string(),
    }),
    v.object({
      operation: v.literal('archive'),
      taskId: v.id('tasks'),
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
      case 'sweep': {
        switch (params.kind) {
          case 'stale': {
            const tasks = await ctx.runMutation(
              internal.tasks.internal_mutations.sweepStaleTasks,
              {
                organizationId,
                staleAfterHours: params.staleAfterHours ?? 24,
                limit: params.limit,
              },
            );
            return { operation: 'sweep', kind: params.kind, tasks };
          }
          case 'due_soon': {
            const tasks = await ctx.runMutation(
              internal.tasks.internal_mutations.sweepDueSoonTasks,
              {
                organizationId,
                windowHours: params.windowHours ?? 24,
                limit: params.limit,
              },
            );
            return { operation: 'sweep', kind: params.kind, tasks };
          }
          case 'overdue_ladder': {
            const rows = await ctx.runMutation(
              internal.tasks.internal_mutations.sweepOverdueLadder,
              {
                organizationId,
                managerEscalationHours: params.managerEscalationHours ?? 24,
                adminEscalationHours: params.adminEscalationHours ?? 72,
                limit: params.limit,
              },
            );
            // Level-3 rows escalate to the assignee's MANAGER — resolved here
            // in the action layer (the org chart lives in agent files, which
            // the sweep mutation cannot read). One chart read per sweep.
            const needsManager = rows.filter(
              (row) =>
                row.newLevel === 3 &&
                row.assigneeType === 'agent' &&
                row.assigneeId,
            );
            const managerBySlug = new Map<string, string | undefined>();
            for (const row of needsManager) {
              const slug = row.assigneeId;
              if (!slug || managerBySlug.has(slug)) continue;
              const role = await ctx.runAction(
                internal.agents.workforce_ops.getOrgRole,
                { organizationId, agentSlug: slug },
              );
              managerBySlug.set(slug, role.managerSlug);
            }
            const tasks = [];
            for (const row of rows) {
              const assigneeManagerSlug =
                row.assigneeType === 'agent' && row.assigneeId
                  ? managerBySlug.get(row.assigneeId)
                  : undefined;
              tasks.push({ ...row, assigneeManagerSlug });
            }
            return { operation: 'sweep', kind: params.kind, tasks };
          }
          case 'archivable': {
            const tasks = await ctx.runMutation(
              internal.tasks.internal_mutations.sweepArchivableTasks,
              {
                organizationId,
                olderThanDays: params.olderThanDays ?? 30,
                limit: params.limit,
              },
            );
            return { operation: 'sweep', kind: params.kind, tasks };
          }
          default: {
            const unhandledKind: never = params.kind;
            throw new Error(
              `Unsupported sweep kind: ${JSON.stringify(unhandledKind)}`,
            );
          }
        }
      }

      case 'get': {
        const task = await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: toId<'tasks'>(params.taskId), organizationId },
        );
        return { operation: 'get', task };
      }

      case 'subtask_progress': {
        const progress = await ctx.runQuery(
          internal.tasks.internal_queries.getSubtaskProgress,
          { taskId: toId<'tasks'>(params.taskId), organizationId },
        );
        return { operation: 'subtask_progress', ...progress };
      }

      case 'list_dependents': {
        const tasks = await ctx.runQuery(
          internal.tasks.internal_queries.listDependentTasks,
          { taskId: toId<'tasks'>(params.taskId), organizationId },
        );
        return { operation: 'list_dependents', tasks };
      }

      case 'list_open_for_assignee': {
        const tasks = await ctx.runQuery(
          internal.tasks.internal_queries.listOpenTasksForAssignee,
          {
            organizationId,
            assigneeType: params.assigneeType,
            assigneeId: params.assigneeId,
          },
        );
        return { operation: 'list_open_for_assignee', tasks };
      }

      case 'archive': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentArchiveTask,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
          },
        );
        return { operation: 'archive', ...result };
      }

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
