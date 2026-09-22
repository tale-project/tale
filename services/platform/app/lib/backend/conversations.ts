/**
 * The Inbox vertical over the 0.5 backend. The listing's paginated lane
 * lives in `engagement.ts` (it shares the entity-table idiom); this module
 * carries the rest — the whole-list read, the per-status counts, the
 * conversation detail, and every write the inbox performs.
 *
 * The server already projects a conversation into the shape the UI reads
 * (the SHARED `projectConversationItem`), so these rows are thin: fetch,
 * unwrap, hand over.
 */

import type { QueryClient } from '@tanstack/react-query';

import type {
  AdaptedReadOptions,
  AdapterContext,
  ReadAdapter,
  WriteAdapter,
} from './adapters';
import { backendFetch } from './api-client';
import { backendEntityPrefix, backendKey } from './query-keys';

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

function invalidateConversations(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'conversation'),
  });
}

const LIST_LIMIT = 100;

/** What `/conversations/counts` answers: the per-status map the Inbox tabs
 * read, and the unread total the rail's chip reads. Both come back in ONE
 * body, and both are already narrowed to the caller's inbox scope — an admin
 * sees the organization, everyone else only what is assigned to them or to
 * one of their teams. */
interface ConversationCounts {
  byStatus: Record<string, number>;
  unread: number;
}

/** The shared read behind every count. Keyed on the FETCH (the connector
 * filter) and narrowed by each caller's `select`, so the four status badges
 * and the rail chip issue one request between them. Keyed on the narrowing
 * instead, a cold load fetched the same body five times. */
function conversationCountsRead(
  orgId: string,
  connector: string | undefined,
): Pick<AdaptedReadOptions, 'queryKey' | 'queryFn'> {
  return {
    queryKey: backendKey(orgId, 'conversation', 'count', connector ?? ''),
    queryFn: () =>
      backendFetch<ConversationCounts>(
        `/conversations/counts${connector === undefined ? '' : `?connector=${encodeURIComponent(connector)}`}`,
        { orgId },
      ),
  };
}

function connectorOf(args: Record<string, unknown>): string | undefined {
  return typeof args.connectorName === 'string' && args.connectorName !== ''
    ? args.connectorName
    : undefined;
}

export const conversationReadAdapters: Record<string, ReadAdapter> = {
  'conversations/queries:apiSources': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'conversation', 'api-sources'),
      queryFn: () =>
        backendFetch<{ sources: string[] }>('/conversations/api-sources', {
          orgId,
        }).then((body) => body.sources),
    };
  },
  'conversations/queries:listConversations': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'conversation', 'list'),
      queryFn: () =>
        backendFetch<{ items: unknown[] }>(
          `/conversations?limit=${LIST_LIMIT}`,
          { orgId },
        ).then((body) => body.items),
    };
  },
  'conversations/queries:approxCountConversationsByStatus': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const status = typeof args.status === 'string' ? args.status : 'open';
    return {
      ...conversationCountsRead(orgId, connectorOf(args)),
      select: (body) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queryFn above stores the counts body
        (body as ConversationCounts).byStatus[status] ?? 0,
    };
  },
  'conversations/queries:countUnreadConversations': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      ...conversationCountsRead(orgId, connectorOf(args)),
      select: (body) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queryFn above stores the counts body
        (body as ConversationCounts).unread ?? 0,
    };
  },
  'conversations/queries:getConversationWithMessages': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const conversationId =
      typeof args.conversationId === 'string' ? args.conversationId : '';
    if (conversationId === '') return null;
    return {
      queryKey: backendKey(orgId, 'conversation', 'detail', conversationId),
      queryFn: () =>
        backendFetch<{ item: unknown }>(
          `/conversations/${encodeURIComponent(conversationId)}`,
          { orgId },
        )
          .then((body) => body.item)
          // A conversation the viewer cannot see reads as `null` — the 0.4
          // query's own answer, which the panel renders as "not found"
          // rather than an error toast.
          .catch(() => null),
    };
  },
};

/** The five bulk verbs share one door; the 0.4 names differ only in verb. */
function bulkAdapter(verb: string): WriteAdapter {
  return {
    run: (args, ctx) =>
      backendFetch<unknown>(`/conversations/bulk/${verb}`, {
        orgId: requireOrg(args, ctx),
        body: {
          conversationIds: Array.isArray(args.conversationIds)
            ? args.conversationIds
            : [],
        },
      }),
    invalidate: invalidateConversations,
  };
}

/** A status change through the PATCH door (close/reopen/spam). */
function statusAdapter(status: string): WriteAdapter {
  return {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}`,
        {
          orgId: requireOrg(args, ctx),
          method: 'PATCH',
          body: { status },
        },
      ).then(() => null),
    invalidate: invalidateConversations,
  };
}

export const conversationWriteAdapters: Record<string, WriteAdapter> = {
  'conversations/mutations:bulkCloseConversations': bulkAdapter('close'),
  'conversations/mutations:bulkReopenConversations': bulkAdapter('reopen'),
  'conversations/mutations:bulkSpamConversations': bulkAdapter('spam'),
  'conversations/mutations:bulkArchiveConversations': bulkAdapter('archive'),
  'conversations/mutations:bulkUnarchiveConversations':
    bulkAdapter('unarchive'),
  'conversations/mutations:closeConversation': statusAdapter('closed'),
  'conversations/mutations:reopenConversation': statusAdapter('open'),
  'conversations/mutations:markConversationAsSpam': statusAdapter('spam'),
  'conversations/mutations:markConversationAsRead': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}/read`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:assignConversation': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}/assign`,
        {
          orgId: requireOrg(args, ctx),
          // An absent assignee is the UNASSIGN gesture, not a missing arg.
          body: {
            assigneeUserId:
              typeof args.assigneeUserId === 'string'
                ? args.assigneeUserId
                : null,
          },
        },
      ).then(() => null),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:assignConversationTeam': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}/assign-team`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            assigneeTeamId:
              typeof args.assigneeTeamId === 'string'
                ? args.assigneeTeamId
                : null,
          },
        },
      ).then(() => null),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:deleteConversation': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:sendMessageViaConnector': {
    run: (args, ctx) =>
      backendFetch<{ messageId: string }>(
        `/conversations/${encodeURIComponent(stringArg(args, 'conversationId'))}/reply`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            content: stringArg(args, 'content'),
            ...(typeof args.sourceMarkdown === 'string'
              ? { sourceMarkdown: args.sourceMarkdown }
              : {}),
            ...(Array.isArray(args.attachments)
              ? { attachments: args.attachments }
              : {}),
          },
        },
      ).then((body) => body.messageId),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:composeEmailConversation': {
    run: (args, ctx) =>
      backendFetch<unknown>('/conversations/compose', {
        orgId: requireOrg(args, ctx),
        body: {
          contactId: stringArg(args, 'contactId'),
          connectorName: stringArg(args, 'connectorName'),
          subject: stringArg(args, 'subject'),
          content: stringArg(args, 'content'),
          ...(typeof args.sourceMarkdown === 'string'
            ? { sourceMarkdown: args.sourceMarkdown }
            : {}),
          ...(typeof args.from === 'string' ? { from: args.from } : {}),
          ...(typeof args.assigneeUserId === 'string'
            ? { assigneeUserId: args.assigneeUserId }
            : {}),
          ...(typeof args.assigneeTeamId === 'string'
            ? { assigneeTeamId: args.assigneeTeamId }
            : {}),
          ...(Array.isArray(args.attachments)
            ? { attachments: args.attachments }
            : {}),
        },
      }),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:undoSendMessage': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/conversations/messages/${encodeURIComponent(stringArg(args, 'messageId'))}/undo`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:retrySendMessage': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/conversations/messages/${encodeURIComponent(stringArg(args, 'messageId'))}/retry`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateConversations,
  },
  'conversations/mutations:discardOutboundMessage': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/conversations/messages/${encodeURIComponent(stringArg(args, 'messageId'))}/discard`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateConversations,
  },
  // The composer's AI rewrite: one bounded model call on the door; nothing
  // is stored, so there is nothing to invalidate.
  'conversations/actions:improveMessage': {
    run: (args, ctx) =>
      backendFetch<{ improvedMessage: string }>('/conversations/improve', {
        orgId: requireOrg(args, ctx),
        body: {
          originalMessage: stringArg(args, 'originalMessage'),
          ...(typeof args.instruction === 'string' && args.instruction !== ''
            ? { instruction: args.instruction }
            : {}),
        },
      }),
  },
};
