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
 *
 * Archived rows are RETURNED, not filtered. A retired project is often still
 * the only record of a decision, so hiding it makes chat worse at exactly the
 * questions history answers. The caller labels them instead: `archivedAt` on
 * the row itself, and the project's archive state from
 * `KnowledgeAccessScope.archivedProjectIds`. What the assistant then says is
 * its own choice, not a fixed sentence in code.
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, type QueryCtx } from '../_generated/server';
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

/** How many tasks a LISTING returns. Smaller than a search page: a list is
 *  read in full by a model with a step budget, not paged through. */
const LIST_CAP = 15;

/**
 * Whether a task is visible to, and wanted by, this caller — the same rule for
 * a search hit and for a listing, so the two can never disagree about scope.
 */
function taskAllowed(
  task: Doc<'tasks'>,
  readable: ReadonlySet<string>,
  status: 'open' | Doc<'tasks'>['status'] | undefined,
): boolean {
  // Project-less work is org-level and readable; anything owned by a project
  // the caller cannot read is invisible, exactly as its parent is.
  if (task.projectId != null && !readable.has(String(task.projectId))) {
    return false;
  }
  if (status === 'open') return !OPEN_EXCLUDES.has(task.status);
  if (status !== undefined) return task.status === status;
  return true;
}

/**
 * Tasks in scope, ignoring the text entirely — the answer to "what is open?".
 *
 * A question about the board carries no searchable term. "Are there any open
 * tasks?" tokenises to `open`/`tasks`/`projects`, and no task title contains
 * those words, so a text match correctly returns nothing and uselessly. Worse,
 * whichever project happens to have the word "tasks" in its DESCRIPTION matches
 * instead, which reads as an answer while being an accident of prose.
 *
 * Deliberately not solved with a denylist of words like `task` and `project`:
 * those appear in real names (a project called "Tale Issues" is found by
 * "issues"), so stripping them would make named things unfindable. The caller
 * falls back to this listing only when the text match found nothing, and says
 * which of the two happened.
 *
 * Ordered like the agent listing: status, then rank. Bounded by `LIST_CAP`.
 */
async function listTasksInScope(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    readable: ReadonlySet<string>;
    status?: 'open' | Doc<'tasks'>['status'];
  },
): Promise<Doc<'tasks'>[]> {
  const rows: Doc<'tasks'>[] = [];
  for await (const task of ctx.db
    .query('tasks')
    .withIndex('by_organization', (q) =>
      q.eq('organizationId', args.organizationId),
    )) {
    if (!taskAllowed(task, args.readable, args.status)) continue;
    rows.push(task);
    if (rows.length >= LIST_CAP) break;
  }
  rows.sort((a, b) =>
    a.status === b.status
      ? a.rank.localeCompare(b.rank)
      : a.status.localeCompare(b.status),
  );
  return rows;
}

export const searchTasksForChat = internalQuery({
  args: {
    organizationId: v.string(),
    /** The projects the caller may read. An empty array matches only
     *  project-less org-level work — never "everything". */
    projectIds: v.array(v.string()),
    term: v.string(),
    /** `open` = not done/cancelled. Any concrete status filters exactly. */
    status: v.optional(v.union(v.literal('open'), taskStatusValidator)),
    /** One project, for "which tasks are in this project?". Narrows BOTH the
     *  search and the listing; still subject to `projectIds`. */
    projectId: v.optional(v.id('projects')),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const readable =
      args.projectId !== undefined
        ? // Narrowing to one project can never widen scope: it must already be
          // readable, or the result is empty.
          new Set(args.projectIds.filter((id) => id === String(args.projectId)))
        : new Set(args.projectIds);
    const status = args.status;
    const found = await runEntitySearch(ctx, tasksSearchStrategy, {
      organizationId: args.organizationId,
      term: args.term,
      paginationOpts: args.paginationOpts,
      matchMode: 'any',
      accessFilter: (task: Doc<'tasks'>) => taskAllowed(task, readable, status),
    });
    if (found.page.length > 0) return { ...found, listed: false };

    // Nothing matched the words. Answer the question the words were describing.
    const rows = await listTasksInScope(ctx, {
      organizationId: args.organizationId,
      readable,
      ...(status !== undefined ? { status } : {}),
    });
    return {
      page: rows,
      isDone: true,
      continueCursor: '',
      /** The caller reports this, so "listed" is never mistaken for "matched". */
      listed: true,
    };
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
    const found = await runEntitySearch(ctx, projectsSearchStrategy, {
      organizationId: args.organizationId,
      term: args.term,
      paginationOpts: args.paginationOpts,
      matchMode: 'any',
      accessFilter: (project: Doc<'projects'>) =>
        readable.has(String(project._id)),
    });
    if (found.page.length > 0) return { ...found, listed: false };

    // "Are there any archived projects?" names no project, so nothing matches
    // and whichever project has the word in its DESCRIPTION wins by accident.
    // List instead — the readable set is already the answer's scope.
    const rows: Doc<'projects'>[] = [];
    for await (const project of ctx.db
      .query('projects')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!readable.has(String(project._id))) continue;
      rows.push(project);
      if (rows.length >= LIST_CAP) break;
    }
    return { page: rows, isDone: true, continueCursor: '', listed: true };
  },
});
