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
import { internalQuery } from '../_generated/server';
import { taskActorTypeValidator, taskStatusValidator } from './schema';

const AGENT_TASK_LIST_CAP = 200;

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
    status: v.optional(taskStatusValidator),
    assigneeType: v.optional(taskActorTypeValidator),
    assigneeId: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'tasks'>[]> => {
    const rows: Doc<'tasks'>[] = [];
    const projectId = args.projectId;
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

export const listTaskCommentsInternal = internalQuery({
  args: {
    taskId: v.id('tasks'),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'taskComments'>[]> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return [];
    const comments = await ctx.db
      .query('taskComments')
      .withIndex('by_task_createdAt', (q) => q.eq('taskId', args.taskId))
      .order('asc')
      .take(200);
    return comments.filter((c) => !c.deletedAt);
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
