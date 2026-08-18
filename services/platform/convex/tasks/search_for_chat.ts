/**
 * Question-shaped search over tasks and projects, for the chat assistant's work
 * legs.
 *
 * Separate from `listTasksForAgent` (a facet listing with no text argument) for
 * the same reason `queryContacts` is separate from the contacts listing: this
 * takes a natural-language question and matches it with `matchMode: 'any'`,
 * because a whole-sentence substring match can never hit a row. See
 * `convex/lib/search/relevance.ts`.
 *
 * ## Scope is the caller's, never the org's
 *
 * A task has no ACL of its own — `tasks/access.ts` delegates to its parent
 * project — so both queries take the readable project set the caller already
 * resolved (`KnowledgeAccessScope.projectIds`, memoised per turn) and filter to
 * it. These are RLS-bypassing internal queries, so passing only
 * `organizationId` would return every project's work to any member. The
 * contacts and products legs can do that safely because those tables are
 * org-scope-and-role only; work is not.
 *
 * A task whose `projectId` is absent is org-level work and readable by any
 * member — matching how `hasProjectAccess` treats a project with no teams.
 * Archived rows are excluded: every other surface excludes them by default
 * (`projects/queries.ts` uses `by_organization_archived`), and a retired
 * project's work should not answer a question about current work.
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import {
  projectsSearchStrategy,
  runEntitySearch,
  tasksSearchStrategy,
} from '../lib/search';
import { taskStatusValidator } from './schema';

/** `status: 'open'` in the tool schema means "not finished", which is two
 *  statuses rather than one — kept next to the filter that applies it so the
 *  mapping cannot drift from `TERMINAL_STATUSES`. */
const OPEN_EXCLUDES = new Set(['done', 'cancelled']);

export const searchTasksForChat = internalQuery({
  args: {
    organizationId: v.string(),
    /** The projects the caller may read. An empty array matches only
     *  project-less org-level work — never "everything". */
    projectIds: v.array(v.string()),
    term: v.string(),
    /** `open` = not done/cancelled. Any concrete status filters exactly. */
    status: v.optional(v.union(v.literal('open'), taskStatusValidator)),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const readable = new Set(args.projectIds);
    const status = args.status;
    return await runEntitySearch(ctx, tasksSearchStrategy, {
      organizationId: args.organizationId,
      term: args.term,
      paginationOpts: args.paginationOpts,
      matchMode: 'any',
      accessFilter: (task: Doc<'tasks'>) => {
        if (task.archivedAt) return false;
        // Project-less work is org-level and readable; anything owned by a
        // project the caller cannot read is invisible, exactly as its parent is.
        if (task.projectId != null && !readable.has(String(task.projectId))) {
          return false;
        }
        if (status === 'open') return !OPEN_EXCLUDES.has(task.status);
        if (status !== undefined) return task.status === status;
        return true;
      },
    });
  },
});

export const searchProjectsForChat = internalQuery({
  args: {
    organizationId: v.string(),
    /** The projects the caller may read — the result set is a subset of these,
     *  so visibility is decided by the caller, not re-derived here. */
    projectIds: v.array(v.string()),
    term: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const readable = new Set(args.projectIds);
    return await runEntitySearch(ctx, projectsSearchStrategy, {
      organizationId: args.organizationId,
      term: args.term,
      paginationOpts: args.paginationOpts,
      matchMode: 'any',
      accessFilter: (project: Doc<'projects'>) =>
        !project.archivedAt && readable.has(String(project._id)),
    });
  },
});
