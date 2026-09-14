// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  engagementPaginatedAdapters,
  engagementReadAdapters,
} from './engagement';

const ctx = { organizationId: 'org1' };

describe('the bell query keys', () => {
  it('key both bells under the entity the backend emits', () => {
    // `use-backend-hints.ts` invalidates `['backend', orgId, hint.entity]`;
    // the collab and org-notification writers emit NOTIFICATION_HINT_ENTITY.
    // Every bell read keys under that same name, or the bell goes silent.
    for (const name of [
      'collab/notifications:myUnreadCount',
      'notifications/queries:unreadCount',
    ]) {
      const read = engagementReadAdapters[name]?.({}, ctx);
      expect(read?.queryKey.slice(0, 3), name).toEqual([
        'backend',
        'org1',
        NOTIFICATION_HINT_ENTITY,
      ]);
    }
    for (const name of [
      'collab/notifications:listMyNotifications',
      'notifications/queries:list',
    ]) {
      const page = engagementPaginatedAdapters[name]?.({}, ctx);
      expect(page?.queryKey.slice(0, 3), name).toEqual([
        'backend',
        'org1',
        NOTIFICATION_HINT_ENTITY,
      ]);
    }
  });

  it('pins the wire literal both ends share', () => {
    expect(NOTIFICATION_HINT_ENTITY).toBe('notification');
  });
});

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe.each([
  ['contacts', 'listContacts', 'listContactsPaginated'],
  ['products', 'listProducts', 'listProductsPaginated'],
])('%s table dates', (entity, listQuery, pageQuery) => {
  const wireRow = {
    id: 'record-1',
    name: 'Review record',
    createdAt: 1770000000000,
    updatedAt: 1770003600000,
  };

  it('supplies the Added and Updated columns in whole-list reads', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [wireRow] })),
    );
    const adapter = engagementReadAdapters[`${entity}/queries:${listQuery}`]?.(
      {},
      ctx,
    );
    expect(await adapter?.queryFn()).toEqual([
      {
        ...wireRow,
        _id: 'record-1',
        _creationTime: wireRow.createdAt,
        lastUpdated: wireRow.updatedAt,
      },
    ]);
  });

  it('supplies table dates without changing the server pagination cursor', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [wireRow],
          nextCursor: { updatedAt: wireRow.updatedAt, id: wireRow.id },
        }),
      ),
    );
    const adapter = engagementPaginatedAdapters[
      `${entity}/queries:${pageQuery}`
    ]?.({}, ctx);
    expect(await adapter?.fetchPage(null, 20)).toEqual({
      page: [
        {
          ...wireRow,
          _id: 'record-1',
          _creationTime: wireRow.createdAt,
          lastUpdated: wireRow.updatedAt,
        },
      ],
      isDone: false,
      continueCursor: `${wireRow.updatedAt}|record-1`,
    });
  });
});
