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
import { TASK_COMMENT_MAX } from '../../../tasks/helpers';
import {
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from '../../../tasks/schema';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

const WORKFLOW_ACTOR_ID = 'workflow';

// Workflow templates interpolate unbounded step output (e.g. an author agent's
// summary) into comments; a body over the mutation's cap must degrade to a
// truncated comment, not fail the step and kill the run.
const TRUNCATION_MARK = '… (truncated)';
function clampCommentBody(text: string): string {
  if (text.length <= TASK_COMMENT_MAX) return text;
  return (
    text.slice(0, TASK_COMMENT_MAX - TRUNCATION_MARK.length) + TRUNCATION_MARK
  );
}

function workflowAttribution(
  variables: Record<string, unknown>,
  extras?: { executionId?: string },
):
  | {
      workflowSlug?: string;
      wfExecutionId?: ReturnType<typeof toId<'wfExecutions'>>;
    }
  | undefined {
  const workflowSlug =
    typeof variables.wfDefinitionId === 'string'
      ? variables.wfDefinitionId
      : undefined;
  const wfExecutionId =
    typeof extras?.executionId === 'string'
      ? toId<'wfExecutions'>(extras.executionId)
      : undefined;
  if (!workflowSlug && !wfExecutionId) return undefined;
  return { workflowSlug, wfExecutionId };
}

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
      /** Optional comment posted (as the workflow actor) just before the
       *  status change — folds the ubiquitous comment→update_status step
       *  pair into one step. */
      comment?: string;
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
      /** Legacy single-locale body (English / pack default). */
      body?: string;
      /** Write-time en/de/fr snapshot; `en` becomes the canonical `body`. */
      bodyI18n?: { en: string; de: string; fr: string };
    }
  | {
      operation: 'list_comments';
      taskId: string;
      /** Keep only these author types (meta `authorType`; workflow-authored
       *  comments are stored as `agent`). Omit → all authors. */
      authorTypes?: ('user' | 'agent')[];
      /** Watermark: return only comments strictly newer than the NEWEST
       *  comment whose body contains this marker (any author — the marker is
       *  matched before `authorTypes` filtering, so a workflow-posted anchor
       *  still consumes user comments). No match → everything. */
      afterMarker?: string;
      /** Keep the most recent N after filtering (result stays ascending).
       *  Non-positive values are ignored. */
      limit?: number;
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
      operation: 'list_open_external';
      externalSystem: string;
      owner: string;
      repo: string;
    }
  | {
      operation: 'archive';
      taskId: string;
    }
  | {
      operation: 'upsert_external';
      projectId?: string;
      externalSystem: string;
      externalId: string;
      title: string;
      externalUrl?: string;
      description?: string;
      labels?: string[];
      priority?: 'p0' | 'p1' | 'p2' | 'p3';
      externalState?: 'open' | 'closed';
      dedupeScope?: 'org' | 'project';
      createIfMissing?: boolean;
    };

export const taskAction: ActionDefinition<TaskActionParams> = {
  type: 'task',
  title: 'Task Operation',
  description:
    'Create, read, and update tasks on the project board (create, get, update_status, assign, comment, list_comments, archive, subtask_progress, list_dependents, list_open_for_assignee, list_open_external, upsert_external) plus the pack maintenance sweeps (sweep kinds: stale, due_soon, overdue_ladder, archivable — atomic mark-and-return, safe under repeated crons). upsert_external idempotently links an external item (e.g. a GitHub issue) to a task by (externalSystem, externalId). organizationId is read from workflow context variables.',
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
      comment: v.optional(v.string()),
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
      body: v.optional(v.string()),
      bodyI18n: v.optional(
        v.object({
          en: v.string(),
          de: v.string(),
          fr: v.string(),
        }),
      ),
    }),
    v.object({
      operation: v.literal('list_comments'),
      taskId: v.id('tasks'),
      authorTypes: v.optional(v.array(taskActorTypeValidator)),
      afterMarker: v.optional(v.string()),
      limit: v.optional(v.number()),
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
      operation: v.literal('list_open_external'),
      externalSystem: v.string(),
      owner: v.string(),
      repo: v.string(),
    }),
    v.object({
      operation: v.literal('archive'),
      taskId: v.id('tasks'),
    }),
    v.object({
      operation: v.literal('upsert_external'),
      // Optional: an org-scope, update-only reconcile (createIfMissing:false)
      // needs no project — only the create path does.
      projectId: v.optional(v.id('projects')),
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
      dedupeScope: v.optional(v.union(v.literal('org'), v.literal('project'))),
      // false → only update tasks already on the board (close/reopen), never
      // create one per issue. Default (create) keeps the intake-sync behavior.
      createIfMissing: v.optional(v.boolean()),
    }),
  ),
  async execute(ctx, params, variables, extras) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'task action requires a string organizationId in workflow context',
      );
    }
    const attribution = workflowAttribution(variables, extras);

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
            // The manager-escalation rung retired with the org chart:
            // `assigneeManagerSlug` is no longer resolved, so level-3 rows
            // fall through to the pack's human/admin escalation branch.
            return { operation: 'sweep', kind: params.kind, tasks: rows };
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

      case 'list_open_external': {
        // `parametersValidator` declares `owner`/`repo` required, but the
        // workflow engine calls `execute` directly without validating
        // (`execute_action_node.ts`), so a scheduled reconcile whose
        // `variables` never received an `owner`/`repo` value reaches here with
        // them undefined. Fail loudly with an actionable message instead of
        // letting the query's generic ArgumentValidationError surface — and
        // instead of degrading to an org-wide scan, which would close tasks in
        // repos this desk was never configured to touch.
        if (!params.owner || !params.repo) {
          throw new Error(
            'list_open_external requires both `owner` and `repo`, but they were not provided. ' +
              "The schedule is missing them — open this workflow's Triggers tab and set " +
              '`owner`/`repo` on its schedule variables, or pass owner/repo explicitly on this run.',
          );
        }
        const refs = await ctx.runQuery(
          internal.tasks.internal_queries.listOpenExternalTaskRefs,
          {
            organizationId,
            externalSystem: params.externalSystem,
            owner: params.owner,
            repo: params.repo,
          },
        );
        return { operation: 'list_open_external', refs };
      }

      case 'archive': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentArchiveTask,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
            attribution,
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
            attribution,
          },
        );
        return await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: result.taskId, organizationId },
        );
      }

      case 'update_status': {
        if (params.comment !== undefined && params.comment.trim() !== '') {
          // The ride-along comment is garnish on the status change — clamp it
          // and log a post failure, never let it block the transition.
          try {
            await ctx.runMutation(
              internal.tasks.internal_mutations.agentAddComment,
              {
                organizationId,
                actorId: WORKFLOW_ACTOR_ID,
                taskId: toId<'tasks'>(params.taskId),
                body: clampCommentBody(params.comment.trim()),
              },
            );
          } catch (error) {
            console.error(
              '[workflow] task.update_status ride-along comment failed (status change proceeds)',
              error,
            );
          }
        }
        return await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpdateTaskStatus,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            taskId: toId<'tasks'>(params.taskId),
            status: params.status,
            attribution,
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
            attribution,
          },
        );
      }

      case 'comment': {
        // A comment is a NOTIFICATION. Over-long bodies are clamped and every
        // failure path degrades to `{posted: false}` instead of throwing — a
        // lost log line must never fail the step and kill the run (a 10k
        // author summary once burned a whole run this way). Static authoring
        // mistakes belong to publish-time validation, not a run-time crash.
        const bodyI18n = params.bodyI18n;
        const body = clampCommentBody(
          bodyI18n?.en?.trim() ||
            (typeof params.body === 'string' ? params.body.trim() : ''),
        );
        if (!body) {
          console.warn(
            '[workflow] task.comment skipped — empty `body` / `bodyI18n.en` (template rendered nothing)',
          );
          return { posted: false, error: 'empty body' };
        }
        if (bodyI18n) {
          const de = bodyI18n.de?.trim() ?? '';
          const fr = bodyI18n.fr?.trim() ?? '';
          if (!de || !fr) {
            console.warn(
              '[workflow] task.comment skipped — `bodyI18n` requires non-empty en, de, and fr',
            );
            return { posted: false, error: 'bodyI18n missing a locale' };
          }
        }
        try {
          const result = await ctx.runMutation(
            internal.tasks.internal_mutations.agentAddComment,
            {
              organizationId,
              actorId: WORKFLOW_ACTOR_ID,
              taskId: toId<'tasks'>(params.taskId),
              body,
              ...(bodyI18n
                ? {
                    bodyByLocale: {
                      en: clampCommentBody(bodyI18n.en.trim()),
                      de: clampCommentBody(bodyI18n.de.trim()),
                      fr: clampCommentBody(bodyI18n.fr.trim()),
                    },
                  }
                : {}),
              attribution,
            },
          );
          return { posted: true, ...result };
        } catch (error) {
          console.error(
            '[workflow] task.comment failed — run continues without the comment',
            error,
          );
          return {
            posted: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case 'list_comments': {
        const all = await ctx.runQuery(
          internal.tasks.internal_queries.listTaskDiscussionMessagesInternal,
          { taskId: toId<'tasks'>(params.taskId), organizationId },
        );
        // Order by createdAt, not array order — the message store is
        // chronological today, but the watermark below compares timestamps
        // and must not depend on that staying true.
        let comments = [...all].sort((a, b) => a.createdAt - b.createdAt);
        if (params.afterMarker) {
          const marker = params.afterMarker;
          // Watermark over ALL comments (before the author filter): the
          // anchor is typically workflow-posted, yet must still consume the
          // user comments that preceded it.
          let watermark = -1;
          for (const m of comments) {
            if (m.body.includes(marker) && m.createdAt > watermark) {
              watermark = m.createdAt;
            }
          }
          comments = comments.filter((m) => m.createdAt > watermark);
        }
        if (params.authorTypes && params.authorTypes.length > 0) {
          const allowed = new Set<string>(params.authorTypes);
          comments = comments.filter((m) => allowed.has(m.authorType));
        }
        if (typeof params.limit === 'number' && params.limit > 0) {
          comments = comments.slice(-params.limit);
        }
        return { operation: 'list_comments', comments, count: comments.length };
      }

      case 'upsert_external': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            projectId: params.projectId
              ? toId<'projects'>(params.projectId)
              : undefined,
            externalSystem: params.externalSystem,
            externalId: params.externalId,
            title: params.title,
            externalUrl: params.externalUrl,
            description: params.description,
            // A background re-sync must not clobber a task's clean/localized
            // description (e.g. one a user set via quick-create) — the
            // description is a stable pointer; the agent reads live details.
            descriptionMode: 'preserve',
            labels: params.labels,
            priority: params.priority,
            externalState: params.externalState,
            dedupeScope: params.dedupeScope,
            createIfMissing: params.createIfMissing,
            attribution,
          },
        );
        // An update-only reconcile (createIfMissing:false) no-ops when the issue
        // has no task on the board — there's nothing to fetch or return.
        const task = result.taskId
          ? await ctx.runQuery(
              internal.tasks.internal_queries.getTaskByIdInternal,
              { taskId: result.taskId, organizationId },
            )
          : null;
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
