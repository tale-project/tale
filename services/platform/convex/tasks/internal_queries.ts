/**
 * Internal queries for the tasks feature.
 *
 * Called by the agent tools (`agent_tools/tasks/*`) via `ctx.runQuery`. They
 * enforce organization isolation — the tool passes `organizationId` from
 * `ToolCtx` and these queries refuse to return rows from a different org — but
 * do NOT run team-based project access (agents are not team members; which
 * agents may run at all is gated by `project.agentMode`/`allowedAgentSlugs`
 * upstream). Returning `null`/empty on mismatch (rather than throwing) keeps
 * the tool surface from leaking cross-tenant existence.
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
import { getThreadMessages } from '../threads/get_thread_messages';
import { TERMINAL_STATUSES } from './helpers';
import { parseIssueNumber, parseRepoRef } from './issue_ref';
import { taskAssigneeTypeValidator, taskStatusValidator } from './schema';

const AGENT_TASK_LIST_CAP = 200;
const TASK_COMMENTS_CAP = 500;

/**
 * A task comment in the unified model: a `task_discussion` message joined with
 * its side-car meta (author / `editedAt` / parsed `mentions`). Superset of the
 * legacy `taskComments` doc fields the agent prompt + UI read
 * (`authorType`/`authorId`/`body`/`createdAt`), so consumers are byte-compatible.
 */
export interface TaskDiscussionMessage {
  messageId: string;
  authorType: 'user' | 'agent';
  authorId: string;
  body: string;
  createdAt: number;
  editedAt?: number;
  mentions?: Array<{ type: 'user' | 'agent'; id: string }>;
  /** Write-time locale snapshot when the workflow posted `bodyI18n`. */
  bodyByLocale?: { en: string; de: string; fr: string };
}

/**
 * Read a task's comments from its `task_discussion` thread: join the message
 * store (bodies, chronological) with `taskDiscussionMessageMeta` (author/
 * editedAt/mentions). Returns [] when the task has no discussion thread yet.
 * Reads ONLY `tasks.discussionThreadId` — never the private `tasks.threadId`
 * agent run thread. Plain helper so both the internal list query and
 * `getTaskContextForAgent` share one join (queries can't `runQuery`).
 */
export async function readTaskDiscussionMessages(
  ctx: QueryCtx,
  task: Doc<'tasks'>,
): Promise<TaskDiscussionMessage[]> {
  if (!task.discussionThreadId) return [];
  const { messages } = await getThreadMessages(ctx, task.discussionThreadId);
  const metas = await ctx.db
    .query('taskDiscussionMessageMeta')
    .withIndex('by_task', (q) => q.eq('taskId', task._id))
    .collect();
  const metaById = new Map(metas.map((m) => [m.messageId, m]));
  return messages.slice(0, TASK_COMMENTS_CAP).map((msg) => {
    const meta = metaById.get(msg._id);
    return {
      messageId: msg._id,
      // The meta row is the source of truth (written in lockstep); fall back
      // to the message role only defensively if a meta row is ever missing.
      authorType: meta?.authorType ?? (msg.role === 'user' ? 'user' : 'agent'),
      authorId: meta?.authorId ?? '',
      body: msg.content,
      createdAt: meta?.createdAt ?? msg._creationTime,
      editedAt: meta?.editedAt,
      mentions: meta?.mentions,
      bodyByLocale: meta?.bodyByLocale,
    };
  });
}

/**
 * List a task's comments (unified `task_discussion` model). Replaces
 * `listTaskCommentsInternal`; the returned shape is a superset of the legacy
 * `{authorType,authorId,body,createdAt}` the agent prompt reads.
 */
export const listTaskDiscussionMessagesInternal = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<TaskDiscussionMessage[]> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return [];
    return readTaskDiscussionMessages(ctx, task);
  },
});

export const getTaskByIdInternal = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'tasks'> | null> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return null;
    return task;
  },
});

export const listTasksForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id('projects')),
    // A bound org-wide run restricts the org-level listing to its automation's
    // bound projects. Ignored when a single `projectId` is given.
    projectIds: v.optional(v.array(v.id('projects'))),
    status: v.optional(taskStatusValidator),
    assigneeType: v.optional(taskAssigneeTypeValidator),
    assigneeId: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'tasks'>[]> => {
    const rows: Doc<'tasks'>[] = [];
    const projectId = args.projectId;
    const allowedProjects =
      projectId === undefined && args.projectIds !== undefined
        ? new Set(args.projectIds.map(String))
        : undefined;
    const source = projectId
      ? ctx.db
          .query('tasks')
          .withIndex('by_project', (q) => q.eq('projectId', projectId))
      : ctx.db
          .query('tasks')
          .withIndex('by_organization', (q) =>
            q.eq('organizationId', args.organizationId),
          );

    for await (const task of source) {
      if (task.organizationId !== args.organizationId) continue;
      if (
        allowedProjects !== undefined &&
        !allowedProjects.has(String(task.projectId))
      )
        continue;
      if (!args.includeArchived && task.archivedAt) continue;
      if (args.status && task.status !== args.status) continue;
      if (args.assigneeType && task.assigneeType !== args.assigneeType)
        continue;
      if (args.assigneeId && task.assigneeId !== args.assigneeId) continue;
      rows.push(task);
      if (rows.length >= AGENT_TASK_LIST_CAP) break;
    }
    rows.sort((a, b) =>
      a.status === b.status
        ? a.rank.localeCompare(b.rank)
        : a.status.localeCompare(b.status),
    );
    return rows;
  },
});

export const getProjectByIdInternal = internalQuery({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'projects'> | null> => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) return null;
    return project;
  },
});

export const listProjectsForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'projects'>[]> => {
    const rows: Doc<'projects'>[] = [];
    for await (const project of ctx.db
      .query('projects')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!args.includeArchived && project.archivedAt) continue;
      rows.push(project);
      if (rows.length >= AGENT_TASK_LIST_CAP) break;
    }
    return rows;
  },
});

/**
 * Full task snapshot for an agent run on a task: the task itself, its
 * project (name/key/instructions), subtasks, blocking dependencies, and the
 * most recent comments. One query so `run_agent_on_task` assembles its
 * prompt from a single consistent read. Org-isolated like everything here.
 */
export const getTaskContextForAgent = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
    commentLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    task: Doc<'tasks'>;
    project: {
      name: string;
      key?: string;
      instructions?: string;
    } | null;
    subtasks: Array<{ title: string; status: string; assigneeId?: string }>;
    blockedBy: Array<{ title: string; status: string }>;
    comments: Array<{
      authorType: string;
      authorId: string;
      body: string;
      createdAt: number;
    }>;
  } | null> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return null;

    const project = await ctx.db.get(task.projectId);

    const subtasks: Array<{
      title: string;
      status: string;
      assigneeId?: string;
    }> = [];
    for await (const child of ctx.db
      .query('tasks')
      .withIndex('by_parent', (q) => q.eq('parentTaskId', args.taskId))) {
      if (child.archivedAt) continue;
      subtasks.push({
        title: child.title,
        status: child.status,
        assigneeId: child.assigneeId,
      });
      if (subtasks.length >= 50) break;
    }

    const blockedBy: Array<{ title: string; status: string }> = [];
    for await (const edge of ctx.db
      .query('taskDependencies')
      .withIndex('by_blocked', (q) => q.eq('blockedTaskId', args.taskId))) {
      const blocker = await ctx.db.get(edge.blockerTaskId);
      if (blocker && !blocker.archivedAt) {
        blockedBy.push({ title: blocker.title, status: blocker.status });
      }
      if (blockedBy.length >= 25) break;
    }

    const commentLimit = Math.min(Math.max(args.commentLimit ?? 10, 1), 50);
    // Unified model: comments are the task's `task_discussion` messages.
    // Chronological asc → take the most recent `commentLimit`.
    const allComments = await readTaskDiscussionMessages(ctx, task);
    const comments = allComments.slice(-commentLimit).map((c) => ({
      authorType: c.authorType,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt,
    }));

    return {
      task,
      project: project
        ? {
            name: project.name,
            key: project.key,
            instructions: project.instructions,
          }
        : null,
      subtasks,
      blockedBy,
      comments,
    };
  },
});

/**
 * Sibling-completion progress for a task's PARENT — the subtask-rollup
 * workflow's one read. Called with the subtask whose status just changed;
 * answers "are all of the parent's children closed now?".
 */
export const getSubtaskProgress = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
  },
  returns: v.object({
    hasParent: v.boolean(),
    parentTaskId: v.optional(v.id('tasks')),
    parentStatus: v.optional(taskStatusValidator),
    parentAssigneeType: v.optional(taskAssigneeTypeValidator),
    parentAssigneeId: v.optional(v.string()),
    parentArchived: v.boolean(),
    total: v.number(),
    closed: v.number(),
    allClosed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const none = {
      hasParent: false,
      parentArchived: false,
      total: 0,
      closed: 0,
      allClosed: false,
    };
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return none;
    if (!task.parentTaskId) return none;
    const parent = await ctx.db.get(task.parentTaskId);
    if (!parent || parent.organizationId !== args.organizationId) return none;

    let total = 0;
    let closed = 0;
    for await (const child of ctx.db
      .query('tasks')
      .withIndex('by_parent', (q) => q.eq('parentTaskId', parent._id))) {
      if (child.archivedAt) continue;
      total += 1;
      if (child.status === 'done' || child.status === 'cancelled') closed += 1;
    }
    return {
      hasParent: true,
      parentTaskId: parent._id,
      parentStatus: parent.status,
      parentAssigneeType: parent.assigneeType,
      parentAssigneeId: parent.assigneeId,
      parentArchived: parent.archivedAt !== undefined,
      total,
      closed,
      allClosed: total > 0 && closed === total,
    };
  },
});

/**
 * Tasks blocked by `taskId`, each with its remaining OPEN blocker count
 * (excluding archived blockers; the just-closed source task is terminal and
 * therefore not counted). `openBlockerCount === 0` means fully unblocked.
 * Bounded: ≤50 dependents, ≤25 blockers inspected per dependent.
 */
export const listDependentTasks = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
  },
  returns: v.array(
    v.object({
      taskId: v.id('tasks'),
      projectId: v.id('projects'),
      title: v.string(),
      status: taskStatusValidator,
      assigneeType: v.optional(taskAssigneeTypeValidator),
      assigneeId: v.optional(v.string()),
      openBlockerCount: v.number(),
      agentRunsPaused: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const blocker = await ctx.db.get(args.taskId);
    if (!blocker || blocker.organizationId !== args.organizationId) return [];

    const edges = await ctx.db
      .query('taskDependencies')
      .withIndex('by_blocker', (q) => q.eq('blockerTaskId', args.taskId))
      .take(50);

    const rows: Array<{
      taskId: Doc<'tasks'>['_id'];
      projectId: Doc<'tasks'>['projectId'];
      title: string;
      status: Doc<'tasks'>['status'];
      assigneeType?: 'user' | 'agent' | 'app';
      assigneeId?: string;
      openBlockerCount: number;
      agentRunsPaused: boolean;
    }> = [];
    for (const edge of edges) {
      const dependent = await ctx.db.get(edge.blockedTaskId);
      if (!dependent || dependent.archivedAt) continue;
      if (dependent.organizationId !== args.organizationId) continue;

      let openBlockerCount = 0;
      const blockerEdges = await ctx.db
        .query('taskDependencies')
        .withIndex('by_blocked', (q) => q.eq('blockedTaskId', dependent._id))
        .take(25);
      for (const blockerEdge of blockerEdges) {
        const other = await ctx.db.get(blockerEdge.blockerTaskId);
        if (!other || other.archivedAt) continue;
        if (other.status !== 'done' && other.status !== 'cancelled') {
          openBlockerCount += 1;
        }
      }

      rows.push({
        taskId: dependent._id,
        projectId: dependent.projectId,
        title: dependent.title,
        status: dependent.status,
        assigneeType: dependent.assigneeType,
        assigneeId: dependent.assigneeId,
        openBlockerCount,
        agentRunsPaused: dependent.agentRunsPausedAt !== undefined,
      });
    }
    return rows;
  },
});

/**
 * How many (non-archived) subtasks of `taskId` were created at/after
 * `sinceMs`. Lets a decomposition run report what it actually produced —
 * the assignment workflow branches on zero.
 */
export const countSubtasksCreatedSince = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
    sinceMs: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return 0;
    let count = 0;
    for await (const child of ctx.db
      .query('tasks')
      .withIndex('by_parent', (q) => q.eq('parentTaskId', args.taskId))) {
      if (child.archivedAt) continue;
      if (child.createdAt >= args.sinceMs) count += 1;
    }
    return count;
  },
});

/**
 * Open (non-terminal, non-archived) tasks assigned to one actor — the
 * budget-reassign workflow's worklist for a paused agent. Bounded to 50.
 */
export const listOpenTasksForAssignee = internalQuery({
  args: {
    organizationId: v.string(),
    assigneeType: taskAssigneeTypeValidator,
    assigneeId: v.string(),
  },
  returns: v.array(
    v.object({
      taskId: v.id('tasks'),
      projectId: v.id('projects'),
      title: v.string(),
      status: taskStatusValidator,
      agentRunsPaused: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows: Array<{
      taskId: Doc<'tasks'>['_id'];
      projectId: Doc<'tasks'>['projectId'];
      title: string;
      status: Doc<'tasks'>['status'];
      agentRunsPaused: boolean;
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_assignee', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('assigneeType', args.assigneeType)
          .eq('assigneeId', args.assigneeId),
      )) {
      if (task.archivedAt) continue;
      if (task.status === 'done' || task.status === 'cancelled') continue;
      rows.push({
        taskId: task._id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        agentRunsPaused: task.agentRunsPausedAt !== undefined,
      });
      if (rows.length >= 50) break;
    }
    return rows;
  },
});

/** Safety ceiling for a single reconcile pass. Not a page window: it never
 *  silently drops the tail (unlike the old issue-list `per_page:100`) — hitting
 *  it is logged so an operator sees a board that has outgrown one pass. Set far
 *  above any realistic open-task count for one repo. */
const RECONCILE_REFS_CAP = 5000;

/**
 * External refs for the NON-TERMINAL tasks on a board that are bound to one
 * repo's issues — the enumeration a task-first reconcile loops over to re-check
 * each open task's upstream issue state (closed → done). Keyed off the board's
 * own tasks, NOT a repository issue listing, so there is no "newest N issues"
 * window: a task whose issue is old still gets reconciled.
 *
 * Range-scans just this repo's rows on `by_org_external` via the stable
 * `owner/repo#` externalId prefix (the `#` delimiter keeps repo `tale` from
 * matching `tale-foo`), skips archived/terminal tasks, and parses each ref into
 * the `{ owner, repo, issueNumber }` a `get_issue` call needs (JEXL can't split
 * a string). Terminal tasks are excluded on purpose: this pass only closes open
 * work, never reopens (per the reconcile's non-terminal-only scope).
 */
export const listOpenExternalTaskRefs = internalQuery({
  args: {
    organizationId: v.string(),
    externalSystem: v.string(),
    owner: v.string(),
    repo: v.string(),
  },
  returns: v.array(
    v.object({
      taskId: v.id('tasks'),
      externalId: v.string(),
      owner: v.string(),
      repo: v.string(),
      issueNumber: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Range-scan exactly this repo's refs. Lower bound is the "owner/repo#"
    // prefix; the exclusive upper bound bumps the trailing "#" (0x23) to the
    // next byte "$" (0x24), so the scan spans every "owner/repo#<n>" ref and
    // stops before any other key — a sibling repo like "owner/repo-2#…" sorts
    // outside it. ASCII-only and agnostic to the numeric suffix.
    const prefix = `${args.owner}/${args.repo}#`;
    const prefixEnd = `${args.owner}/${args.repo}$`;
    const refs: Array<{
      taskId: Doc<'tasks'>['_id'];
      externalId: string;
      owner: string;
      repo: string;
      issueNumber: number;
    }> = [];
    let capped = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_external', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalSystem', args.externalSystem)
          .gte('externalId', prefix)
          .lt('externalId', prefixEnd),
      )) {
      if (task.archivedAt) continue;
      if (TERMINAL_STATUSES.has(task.status)) continue;
      if (!task.externalId) continue;
      const repoRef = parseRepoRef(task.externalId);
      const issueNumber = parseIssueNumber(task.externalId);
      // A ref that doesn't parse to owner/repo#N can't address an issue; skip it
      // rather than feed a broken get_issue call.
      if (!repoRef || issueNumber === null) continue;
      refs.push({
        taskId: task._id,
        externalId: task.externalId,
        owner: repoRef.owner,
        repo: repoRef.repo,
        issueNumber,
      });
      if (refs.length >= RECONCILE_REFS_CAP) {
        capped = true;
        break;
      }
    }
    if (capped) {
      console.warn(
        `[reconcile] listOpenExternalTaskRefs hit the ${RECONCILE_REFS_CAP} cap for ${prefix} — some open tasks were not returned this pass`,
      );
    }
    return refs;
  },
});
