// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '@/lib/shared/hint-entities';

import {
  engagementPaginatedAdapters,
  engagementReadAdapters,
  engagementWriteAdapters,
  withConvexId,
} from './engagement';

const ctx = { organizationId: 'org1' };

describe('withConvexId', () => {
  it('bridges pg id + createdAt onto the Convex-shaped fields tables read', () => {
    expect(
      withConvexId({
        id: 'c1',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        locale: null,
      }),
    ).toEqual({
      id: 'c1',
      _id: 'c1',
      createdAt: 1_700_000_000_000,
      _creationTime: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      lastUpdated: 1_700_000_100_000,
      locale: null,
    });
  });

  it('does not overwrite an existing _creationTime or lastUpdated', () => {
    expect(
      withConvexId({
        id: 'c1',
        createdAt: 1,
        _creationTime: 2,
        updatedAt: 3,
        lastUpdated: 4,
      }),
    ).toEqual({
      id: 'c1',
      _id: 'c1',
      createdAt: 1,
      _creationTime: 2,
      updatedAt: 3,
      lastUpdated: 4,
    });
  });
});

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

const tableDatesRow = {
  id: 'record-1',
  name: 'Review record',
  createdAt: 1770000000000,
  updatedAt: 1770003600000,
};

describe('contacts table dates', () => {
  const wireRow = tableDatesRow;

  it('supplies the Added and Updated columns in whole-list reads', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [wireRow] })),
    );
    const adapter = engagementReadAdapters['contacts/queries:listContacts']?.(
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
});

describe.each([
  ['contacts', 'listContactsPaginated'],
  ['products', 'listProductsPaginated'],
])('%s table dates', (entity, pageQuery) => {
  const wireRow = tableDatesRow;

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

describe('the contacts listing facets', () => {
  const listing = (args: Record<string, unknown>) =>
    engagementPaginatedAdapters['contacts/queries:listContactsPaginated']?.(
      args,
      ctx,
    );

  /** The address of every page the adapter asked for, origin stripped. */
  async function requested(
    args: Record<string, unknown>,
    cursor: string | null = null,
  ): Promise<string> {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null })),
      );
    await listing(args)?.fetchPage(cursor, 20);
    const input = fetchSpy.mock.calls[0]?.[0];
    fetchSpy.mockRestore();
    return typeof input === 'string' ? input : '';
  }

  // #3618: the Locale facet changed neither the request nor the cache key,
  // so the list kept every contact under an active filter.
  it('asks for the selected Locale and keys its pages apart', async () => {
    expect(await requested({ locale: 'fr' })).toBe(
      '/api/app/contacts?limit=20&locale=fr&orgId=org1',
    );
    expect(listing({ locale: 'fr' })?.queryKey).not.toEqual(
      listing({})?.queryKey,
    );
    expect(listing({ locale: 'fr' })?.queryKey).not.toEqual(
      listing({ locale: 'de' })?.queryKey,
    );
  });

  it('keeps the Locale on every later page', async () => {
    expect(await requested({ locale: 'fr' }, '1770003600000|record-1')).toBe(
      '/api/app/contacts?limit=20&locale=fr&cursorUpdatedAt=1770003600000&cursorId=record-1&orgId=org1',
    );
  });

  it('still asks for the Source, alone and beside the Locale', async () => {
    expect(await requested({ source: 'file_upload' })).toBe(
      '/api/app/contacts?limit=20&source=file_upload&orgId=org1',
    );
    expect(await requested({ source: 'file_upload', locale: 'fr' })).toBe(
      '/api/app/contacts?limit=20&source=file_upload&locale=fr&orgId=org1',
    );
    const keys = [
      listing({}),
      listing({ source: 'file_upload' }),
      listing({ locale: 'file_upload' }),
      listing({ source: 'file_upload', locale: 'fr' }),
    ].map((adapter) => JSON.stringify(adapter?.queryKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keys every facet under the contact entity a write invalidates', () => {
    expect(listing({ locale: 'fr' })?.queryKey.slice(0, 3)).toEqual([
      'backend',
      'org1',
      'contact',
    ]);
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

describe('contacts reads a picker depends on', () => {
  const wireRow = {
    id: 'c-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    createdAt: 1770000000000,
    updatedAt: 1770003600000,
  };

  function listRead(args: Record<string, unknown>) {
    return engagementReadAdapters['contacts/queries:listContacts']?.(args, ctx);
  }

  it('asks the door to narrow the page, and caches that answer under the term', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ items: [wireRow] })));

    const adapter = listRead({ search: '  Ada@Example.com  ' });
    await adapter?.queryFn();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('search=ada%40example.com'),
      expect.anything(),
    );
    // Trimmed and lower-cased, because the door's filter is ILIKE: `Ada` and
    // `ada` are one result set and belong in one cache entry.
    expect(adapter?.queryKey).toContain('ada@example.com');
    expect(listRead({})?.queryKey).not.toEqual(adapter?.queryKey);
  });

  it('asks for the whole first page when nothing was typed', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));

    await listRead({ search: '   ' })?.queryFn();

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('search='),
      expect.anything(),
    );
  });

  it('reads one contact by id, shaped like a row of the listing', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ contact: wireRow })),
    );

    expect(
      await engagementReadAdapters['contacts/queries:getContact']?.(
        { contactId: 'c-1' },
        ctx,
      )?.queryFn(),
    ).toEqual({
      ...wireRow,
      _id: 'c-1',
      _creationTime: wireRow.createdAt,
      lastUpdated: wireRow.updatedAt,
    });
  });

  // The contract used to declare `{success, contactId}` here, which no caller
  // read and the adapter never returned — a lie `useBackendMutation`'s cast
  // could not catch. Anything reading `.contactId` off it would get undefined.
  it('answers a create with the new id itself', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ contactId: 'c-new' })),
    );

    expect(
      await engagementWriteAdapters['contacts/mutations:createContact']?.run(
        { organizationId: 'org1', email: 'ada@example.com' },
        ctx,
      ),
    ).toBe('c-new');
  });
});
