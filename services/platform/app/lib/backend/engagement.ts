/**
 * The engagement + inbox verticals over the 0.5 backend: BOTH notification
 * bells (the per-user collab bell and the org/security notification feed),
 * and the entity tables' paginated lanes — conversations, contacts,
 * products, knowledge entries, websites. Servers landed in their domain
 * increments; these are the adapter rows (each mapping the pg listing's
 * own cursor idiom onto the 0.4 page envelope).
 */

import type { QueryClient } from '@tanstack/react-query';
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

/** The whole-list reads (the pickers and the conversation composer's
 * contact lookup) — the pg listing's first page at its own cap, which is
 * what the 0.4 `listContacts`/`listProducts` reads were too. */
const LIST_LIMIT = 200;

export const engagementReadAdapters: Record<string, ReadAdapter> = {
  'contacts/queries:listContacts': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'contact', 'list'),
      queryFn: () =>
        backendFetch<{ items: unknown[] }>(`/contacts?limit=${LIST_LIMIT}`, {
          orgId,
        }).then((body) => body.items.map(withConvexId)),
    };
  },
  'knowledge_entries/queries:approxCountKnowledgeEntries': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'knowledge_entry', 'count'),
      queryFn: () =>
        backendFetch<{ count: number }>('/knowledge-entries/count', {
          orgId,
        }).then((body) => body.count),
    };
  },
  'knowledge_entries/queries:getKnowledgeEntryVersions': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const entryId = typeof args.entryId === 'string' ? args.entryId : '';
    if (entryId === '') return null;
    return {
      queryKey: backendKey(orgId, 'knowledge_entry', 'versions', entryId),
      queryFn: () =>
        backendFetch<{ versions: unknown[] }>(
          `/knowledge-entries/${encodeURIComponent(entryId)}/versions`,
          { orgId },
        ).then((body) => body.versions.map(withConvexId)),
    };
  },
  'websites/queries:listWebsites': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'website', 'list'),
      queryFn: () =>
        backendFetch<{ items: unknown[] }>(`/websites?limit=${LIST_LIMIT}`, {
          orgId,
        }).then((body) => body.items.map(withConvexId)),
    };
  },
  'websites/queries:approxCountWebsites': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'website', 'count'),
      queryFn: () =>
        backendFetch<{ count: number }>('/websites/count', { orgId }).then(
          (body) => body.count,
        ),
    };
  },
  'contacts/search:searchContacts': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    return {
      queryKey: backendKey(orgId, 'contact', 'search', query),
      queryFn: () =>
        query === ''
          ? Promise.resolve([])
          : backendFetch<{
              hits: {
                contactId: string;
                name: string;
                snippet: string;
                updatedAt: number;
              }[];
            }>(`/contacts/search?q=${encodeURIComponent(query)}`, {
              orgId,
            }).then((body) => body.hits),
    };
  },
  'contacts/queries:approxCountContacts': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'contact', 'count'),
      queryFn: () =>
        backendFetch<{ count: number }>('/contacts/count', { orgId }).then(
          (body) => body.count,
        ),
    };
  },
  'products/queries:listProducts': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'product', 'list'),
      queryFn: () =>
        backendFetch<{ items: unknown[] }>(`/products?limit=${LIST_LIMIT}`, {
          orgId,
        }).then((body) => body.items.map(withConvexId)),
    };
  },
  'products/queries:approxCountProducts': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'product', 'count'),
      queryFn: () =>
        backendFetch<{ count: number }>('/products/count', { orgId }).then(
          (body) => body.count,
        ),
    };
  },
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

function invalidateKnowledgeEntries(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'knowledge_entry'),
  });
}

function invalidateWebsites(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'website'),
  });
}

function invalidateContacts(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'contact'),
  });
}

function invalidateProducts(
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'product'),
  });
}

/** The 0.4 write args minus the routing fields the pg door takes in its
 * path or scope — everything else is the entity body, forwarded as-is. */
function entityBody(
  args: Record<string, unknown>,
  drop: readonly string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (drop.includes(key) || value === undefined) continue;
    body[key] = value;
  }
  return body;
}

export const engagementWriteAdapters: Record<string, WriteAdapter> = {
  'contacts/mutations:createContact': {
    run: (args, ctx) =>
      backendFetch<{ contactId: string }>('/contacts', {
        orgId: requireOrg(args, ctx),
        body: entityBody(args, ['organizationId']),
      }).then((body) => body.contactId),
    invalidate: invalidateContacts,
  },
  'contacts/mutations:updateContact': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/contacts/${encodeURIComponent(stringArg(args, 'contactId'))}`,
        {
          orgId: requireOrg(args, ctx),
          body: entityBody(args, ['organizationId', 'contactId']),
        },
      ).then(() => null),
    invalidate: invalidateContacts,
  },
  'contacts/mutations:deleteContact': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/contacts/${encodeURIComponent(stringArg(args, 'contactId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateContacts,
  },
  'contacts/mutations:bulkCreateContacts': {
    run: (args, ctx) =>
      backendFetch<unknown>('/contacts/bulk', {
        orgId: requireOrg(args, ctx),
        body: { contacts: Array.isArray(args.contacts) ? args.contacts : [] },
      }),
    invalidate: invalidateContacts,
  },
  'knowledge_entries/mutations:createKnowledgeEntry': {
    run: (args, ctx) =>
      backendFetch<{ id: string }>('/knowledge-entries', {
        orgId: requireOrg(args, ctx),
        body: {
          topic: stringArg(args, 'topic'),
          content: stringArg(args, 'content'),
        },
      }).then((body) => body.id),
    invalidate: invalidateKnowledgeEntries,
  },
  'knowledge_entries/mutations:updateKnowledgeEntry': {
    run: (args, ctx) =>
      backendFetch<{ id: string }>(
        `/knowledge-entries/${encodeURIComponent(stringArg(args, 'entryId'))}`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            topic: stringArg(args, 'topic'),
            content: stringArg(args, 'content'),
          },
        },
      ).then((body) => body.id),
    invalidate: invalidateKnowledgeEntries,
  },
  'knowledge_entries/mutations:deleteKnowledgeEntry': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/knowledge-entries/${encodeURIComponent(stringArg(args, 'entryId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateKnowledgeEntries,
  },
  'websites/actions:createWebsite': {
    run: (args, ctx) =>
      backendFetch<{ websiteId: string }>('/websites', {
        orgId: requireOrg(args, ctx),
        body: entityBody(args, ['organizationId']),
      }).then((body) => body.websiteId),
    invalidate: invalidateWebsites,
  },
  'websites/actions:updateWebsite': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/websites/${encodeURIComponent(stringArg(args, 'websiteId'))}`,
        {
          orgId: requireOrg(args, ctx),
          method: 'PATCH',
          body: entityBody(args, ['organizationId', 'websiteId']),
        },
      ).then(() => null),
    invalidate: invalidateWebsites,
  },
  'websites/actions:deleteWebsite': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/websites/${encodeURIComponent(stringArg(args, 'websiteId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateWebsites,
  },
  'websites/actions:resumeScanning': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/websites/${encodeURIComponent(stringArg(args, 'websiteId'))}/resume`,
        { orgId: requireOrg(args, ctx), body: {} },
      ).then(() => null),
    invalidate: invalidateWebsites,
  },
  'websites/actions:syncStatuses': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/websites/sync-statuses', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateWebsites,
  },
  // The pages/chunks/search dialogs call these AS actions (the 0.4 shape),
  // so they ride the write lane even though they only read.
  'websites/actions:fetchPages': {
    run: (args, ctx) => {
      const websiteId = stringArg(args, 'websiteId');
      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const limit = typeof args.limit === 'number' ? args.limit : 100;
      return backendFetch<unknown>(
        `/websites/${encodeURIComponent(websiteId)}/pages?offset=${offset}&limit=${limit}`,
        { orgId: requireOrg(args, ctx) },
      );
    },
  },
  'websites/actions:fetchChunks': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/websites/${encodeURIComponent(stringArg(args, 'websiteId'))}/chunks?url=${encodeURIComponent(stringArg(args, 'url'))}`,
        { orgId: requireOrg(args, ctx) },
      ),
  },
  'websites/actions:searchContent': {
    run: (args, ctx) =>
      backendFetch<unknown>(
        `/websites/${encodeURIComponent(stringArg(args, 'websiteId'))}/search`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            query: stringArg(args, 'query'),
            ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
          },
        },
      ),
  },
  'products/mutations:createProduct': {
    run: (args, ctx) =>
      backendFetch<{ productId: string }>('/products', {
        orgId: requireOrg(args, ctx),
        body: entityBody(args, ['organizationId']),
      }).then((body) => body.productId),
    invalidate: invalidateProducts,
  },
  'products/mutations:updateProduct': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/products/${encodeURIComponent(stringArg(args, 'productId'))}`,
        {
          orgId: requireOrg(args, ctx),
          body: entityBody(args, ['organizationId', 'productId']),
        },
      ).then(() => null),
    invalidate: invalidateProducts,
  },
  'products/mutations:deleteProduct': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/products/${encodeURIComponent(stringArg(args, 'productId'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateProducts,
  },
  'products/mutations:bulkCreateProducts': {
    run: (args, ctx) =>
      backendFetch<unknown>('/products/bulk', {
        orgId: requireOrg(args, ctx),
        body: { products: Array.isArray(args.products) ? args.products : [] },
      }),
    invalidate: invalidateProducts,
  },
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
