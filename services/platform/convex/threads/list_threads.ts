import type {
  Expression,
  FilterBuilder,
  NamedTableInfo,
  PaginationOptions,
} from 'convex/server';

import type { DataModel } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { Thread, ListThreadsArgs } from './types';

type ThreadMetadataFilterBuilder = FilterBuilder<
  NamedTableInfo<DataModel, 'threadMetadata'>
>;

/**
 * `threadMetadata.kind` values that are NOT part of the user-facing chat
 * history. Project/task discussions reuse `chatType: 'general'` but live under
 * Projects, so they must be excluded from the chat sidebar, archive list,
 * command palette, "my chats" count, and bulk sweeps. See `can_access_thread`
 * for the matching read-access rule.
 */
const NON_CHAT_HISTORY_KINDS = [
  'project_discussion',
  'task_discussion',
] as const;

/**
 * True when a thread metadata row is hidden from the user-facing chat history:
 * a fork branch or a discussion. JS-side counterpart of
 * `excludeNonChatHistoryThreads` for callers that `.collect()` then filter in
 * memory.
 */
export function isHiddenFromChatHistory(row: {
  isBranch?: boolean;
  kind?: string;
}): boolean {
  if (row.isBranch === true) return true;
  // Widen the literal tuple to readonly string[] so an arbitrary `kind` string
  // can be tested without narrowing it to one of the literals.
  return (NON_CHAT_HISTORY_KINDS as readonly string[]).includes(row.kind ?? '');
}

/**
 * Convex filter expression that drops project/task discussions from a
 * `threadMetadata` query (but NOT fork branches). The archived chat-history
 * list deliberately keeps branches — only the active-list and command-palette
 * surfaces also hide branches via {@link excludeNonChatHistoryThreads}.
 */
export function excludeDiscussionThreads(
  q: ThreadMetadataFilterBuilder,
): Expression<boolean> {
  return q.and(
    ...NON_CHAT_HISTORY_KINDS.map((kind) => q.neq(q.field('kind'), kind)),
  );
}

/**
 * Convex filter expression that drops fork branches and discussions from a
 * `threadMetadata` query. Shared by the active chat-history listing
 * (`listThreads`) and the command palette (`searchThreadMessages`) so the set
 * of hidden kinds stays defined in exactly one place.
 */
export function excludeNonChatHistoryThreads(
  q: ThreadMetadataFilterBuilder,
): Expression<boolean> {
  return q.and(q.neq(q.field('isBranch'), true), excludeDiscussionThreads(q));
}

export function isGeneralThread(summary?: string): boolean {
  if (!summary || !summary.includes('"general"')) return false;

  try {
    const parsed: unknown = JSON.parse(summary);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      'chatType' in parsed &&
      parsed.chatType === 'general'
    );
  } catch {
    return false;
  }
}

interface ListThreadsPaginatedResult {
  page: Thread[];
  isDone: boolean;
  continueCursor: string;
}

export async function listThreads(
  ctx: QueryCtx,
  args: Pick<ListThreadsArgs, 'userId'> & {
    paginationOpts: PaginationOptions;
    teamId?: string;
    organizationId?: string;
  },
): Promise<ListThreadsPaginatedResult> {
  const result = await ctx.db
    .query('threadMetadata')
    .withIndex('by_userId_chatType_status_updated', (q) =>
      q
        .eq('userId', args.userId)
        .eq('chatType', 'general')
        .eq('status', 'active'),
    )
    .filter((q) => {
      // Filter by organizationId so users who belong to multiple orgs don't
      // see threads created in other tenants. threadMetadata.organizationId
      // is optional for backward-compat with pre-multi-org rows.
      let expr = excludeNonChatHistoryThreads(q);
      if (args.teamId) {
        expr = q.and(expr, q.eq(q.field('teamId'), args.teamId));
      }
      if (args.organizationId) {
        expr = q.and(
          expr,
          q.eq(q.field('organizationId'), args.organizationId),
        );
      }
      return expr;
    })
    .order('desc')
    .paginate(args.paginationOpts);

  return {
    page: result.page.map((row) => ({
      _id: row.threadId,
      _creationTime: row.updatedAt ?? row.createdAt,
      title: row.title,
      status: row.status,
      userId: row.userId,
      generationStatus: row.generationStatus,
      teamId: row.teamId,
      isShared: row.isShared ?? false,
      projectId: row.projectId,
      pinnedAt: row.pinnedAt,
      lastReplyAt: row.lastReplyAt,
      lastReadAt: row.lastReadAt,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
