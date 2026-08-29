/**
 * The engagement + inbox verticals over the 0.5 backend: BOTH notification
 * bells (the per-user collab bell and the org/security notification feed),
 * and the entity tables' paginated lanes — conversations, contacts,
 * products, knowledge entries, websites. Servers landed in their domain
 * increments; these are the adapter rows (each mapping the pg listing's
 * own cursor idiom onto the 0.4 page envelope).
 */

import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { backendFetch } from './api-client';
import type {
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

type CollabUnreadResult = FunctionReturnType<
  typeof api.collab.notifications.myUnreadCount
>;
type OrgUnreadResult = FunctionReturnType<
  typeof api.notifications.queries.unreadCount
>;

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

/** Bridge one pg row (`id`) onto the 0.4 doc identity (`_id`). */
function withConvexId(row: unknown): unknown {
  return row !== null && typeof row === 'object' && 'id' in row
    ? { ...row, _id: row.id }
    : row;
}

interface PageEnvelope {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
}

/** `{items|rows, nextCursor: {ts, id}|null}` → the 0.4 page envelope. */
function compositeEnvelope(
  rows: unknown[],
  nextCursor: Record<string, number | string> | null,
  tsField: string,
): PageEnvelope {
  return {
    page: rows.map(withConvexId),
    isDone: nextCursor === null,
    continueCursor:
      nextCursor === null
        ? ''
        : `${String(nextCursor[tsField] ?? '')}|${String(nextCursor.id ?? '')}`,
  };
}

function keyPart(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function splitCursor(cursor: string | null): { ts: string; id: string } | null {
  if (cursor === null || cursor === '') return null;
  const at = cursor.indexOf('|');
  if (at <= 0) return null;
  return { ts: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

export const engagementReadAdapters: Record<string, ReadAdapter> = {
  'collab/notifications:myUnreadCount': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'notification', 'my-unread'),
      queryFn: () =>
        backendFetch<{ count: CollabUnreadResult }>(
          '/collab/notifications/unread-count',
          { orgId },
        ).then((body) => body.count),
    };
  },
  'notifications/queries:unreadCount': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'notification', 'org-unread'),
      queryFn: () =>
        backendFetch<{ count: OrgUnreadResult }>(
          '/notifications/unread-count',
          { orgId },
        ).then((body) => body.count),
    };
  },
};

export const engagementPaginatedAdapters: Record<string, PaginatedAdapter> = {
  'collab/notifications:listMyNotifications': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'notification', 'my-page'),
      fetchPage: (cursor, numItems) =>
        backendFetch<{ rows: unknown[]; nextCursor: number | null }>(
          `/collab/notifications?limit=${numItems}${cursor !== null && cursor !== '' ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { orgId },
        ).then((body) => ({
          page: body.rows.map(withConvexId),
          isDone: body.nextCursor === null,
          continueCursor:
            body.nextCursor === null ? '' : String(body.nextCursor),
        })),
    };
  },
  'notifications/queries:list': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'notification', 'org-page'),
      fetchPage: (cursor, numItems) => {
        const split = splitCursor(cursor);
        return backendFetch<{
          items: unknown[];
          nextCursor: { createdAt: number; id: string } | null;
        }>(
          `/notifications?limit=${numItems}${split !== null ? `&cursorCreatedAt=${encodeURIComponent(split.ts)}&cursorId=${encodeURIComponent(split.id)}` : ''}`,
          { orgId },
        ).then((body) =>
          compositeEnvelope(body.items, body.nextCursor, 'createdAt'),
        );
      },
    };
  },
  'conversations/queries:listConversationsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qsOf = (key: string): string =>
      typeof args[key] === 'string' && args[key] !== ''
        ? `&${key}=${encodeURIComponent(args[key])}`
        : '';
    const qs =
      qsOf('status') +
      qsOf('priority') +
      qsOf('channel') +
      qsOf('connectorName');
    return {
      queryKey: backendKey(
        orgId,
        'conversation',
        'page',
        keyPart(args.status),
        keyPart(args.priority),
        keyPart(args.channel),
        keyPart(args.connectorName),
      ),
      fetchPage: (cursor, numItems) =>
        backendFetch<PageEnvelope>(
          `/conversations?limit=${numItems}${qs}${cursor !== null && cursor !== '' ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { orgId },
        ).then((body) => ({ ...body, page: body.page.map(withConvexId) })),
    };
  },
  'contacts/queries:listContactsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qsOf = (key: string): string =>
      typeof args[key] === 'string' && args[key] !== ''
        ? `&${key}=${encodeURIComponent(args[key])}`
        : '';
    const qs = qsOf('search') + qsOf('source');
    return {
      queryKey: backendKey(
        orgId,
        'contact',
        'page',
        keyPart(args.search),
        keyPart(args.source),
      ),
      fetchPage: (cursor, numItems) => {
        const split = splitCursor(cursor);
        return backendFetch<{
          items: unknown[];
          nextCursor: { updatedAt: number; id: string } | null;
        }>(
          `/contacts?limit=${numItems}${qs}${split !== null ? `&cursorUpdatedAt=${encodeURIComponent(split.ts)}&cursorId=${encodeURIComponent(split.id)}` : ''}`,
          { orgId },
        ).then((body) =>
          compositeEnvelope(body.items, body.nextCursor, 'updatedAt'),
        );
      },
    };
  },
  'products/queries:listProductsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qsOf = (key: string): string =>
      typeof args[key] === 'string' && args[key] !== ''
        ? `&${key}=${encodeURIComponent(args[key])}`
        : '';
    const qs = qsOf('status') + qsOf('category');
    return {
      queryKey: backendKey(
        orgId,
        'product',
        'page',
        keyPart(args.status),
        keyPart(args.category),
      ),
      fetchPage: (cursor, numItems) => {
        const split = splitCursor(cursor);
        return backendFetch<{
          items: unknown[];
          nextCursor: { updatedAt: number; id: string } | null;
        }>(
          `/products?limit=${numItems}${qs}${split !== null ? `&cursorUpdatedAt=${encodeURIComponent(split.ts)}&cursorId=${encodeURIComponent(split.id)}` : ''}`,
          { orgId },
        ).then((body) =>
          compositeEnvelope(body.items, body.nextCursor, 'updatedAt'),
        );
      },
    };
  },
  'knowledge_entries/queries:listKnowledgeEntriesPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'knowledge_entry', 'page'),
      fetchPage: (cursor, numItems) =>
        backendFetch<{ rows: unknown[]; nextCursor: number | null }>(
          `/knowledge-entries?limit=${numItems}${cursor !== null && cursor !== '' ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { orgId },
        ).then((body) => ({
          page: body.rows.map(withConvexId),
          isDone: body.nextCursor === null,
          continueCursor:
            body.nextCursor === null ? '' : String(body.nextCursor),
        })),
    };
  },
  'websites/queries:listWebsitesPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const qsOf = (key: string, param: string): string =>
      typeof args[key] === 'string' && args[key] !== ''
        ? `&${param}=${encodeURIComponent(args[key])}`
        : '';
    const qs =
      qsOf('status', 'status') +
      qsOf('scanInterval', 'scanInterval') +
      qsOf('searchTerm', 'search');
    return {
      queryKey: backendKey(
        orgId,
        'website',
        'page',
        keyPart(args.status),
        keyPart(args.scanInterval),
        keyPart(args.searchTerm),
      ),
      fetchPage: (cursor, numItems) =>
        backendFetch<PageEnvelope>(
          `/websites?limit=${numItems}${qs}${cursor !== null && cursor !== '' ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { orgId },
        ).then((body) => ({ ...body, page: body.page.map(withConvexId) })),
    };
  },
};

function invalidateBells(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'notification'),
  });
}

export const engagementWriteAdapters: Record<string, WriteAdapter> = {
  'collab/notifications:markNotificationRead': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/collab/notifications/${encodeURIComponent(stringArg(args, 'notificationId'))}/read`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateBells,
  },
  'collab/notifications:markAllNotificationsRead': {
    run: (args, ctx) =>
      backendFetch<{ marked: number }>('/collab/notifications/read-all', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateBells,
  },
  'notifications/mutations:markRead': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/notifications/${encodeURIComponent(stringArg(args, 'notificationId'))}/read`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateBells,
  },
  'notifications/mutations:markAllRead': {
    run: (args, ctx) =>
      backendFetch<{ marked: number }>('/notifications/read-all', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateBells,
  },
};
