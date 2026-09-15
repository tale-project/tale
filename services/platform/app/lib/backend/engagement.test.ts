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

describe('website creation dates', () => {
  const wireRow = {
    id: 'website-1',
    domain: 'example.com',
    createdAt: 1789383600000,
    lastScannedAt: 1789387200000,
    crawledPageCount: 12,
  };
  const wirePage = {
    page: [wireRow],
    isDone: false,
    continueCursor: '1789383600000:website-1',
  };
  const expectedRow = {
    ...wireRow,
    _id: wireRow.id,
    _creationTime: wireRow.createdAt,
  };

  it('reads the app page envelope and supplies Created for whole-list consumers', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(wirePage)),
    );
    const adapter = engagementReadAdapters['websites/queries:listWebsites']?.(
      {},
      ctx,
    );
    expect(await adapter?.queryFn()).toEqual([expectedRow]);
  });

  it('supplies Created without changing scan time or the opaque website cursor', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(wirePage)),
    );
    const adapter = engagementPaginatedAdapters[
      'websites/queries:listWebsitesPaginated'
    ]?.({}, ctx);
    expect(await adapter?.fetchPage(null, 20)).toEqual({
      ...wirePage,
      page: [expectedRow],
    });
  });
});

describe('knowledge entry versions', () => {
  const current = {
    id: 'entry-2',
    topic: 'Shipping times',
    content: 'Orders over CHF 100 ship free.',
    status: 'active',
    supersededAt: null,
  };
  const previous = {
    id: 'entry-1',
    topic: 'Shipping times',
    content: 'Standard shipping takes 2–3 business days.',
    status: 'superseded',
    supersededAt: 1789455000000,
  };

  function read(entryId: string) {
    return engagementReadAdapters[
      'knowledge_entries/queries:getKnowledgeEntryVersions'
    ]?.({ entryId }, ctx);
  }

  it('answers the contract shape — the entry apart, the chain as versions', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ versions: [current, previous] })),
    );

    expect(await read('entry-2')?.queryFn()).toEqual({
      entry: { ...current, _id: 'entry-2' },
      versions: [
        { ...current, _id: 'entry-2' },
        { ...previous, _id: 'entry-1' },
      ],
    });
  });

  it('answers null when the chain no longer holds the entry', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ versions: [previous] })),
    );

    expect(await read('entry-2')?.queryFn()).toBeNull();
  });
});
