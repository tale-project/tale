import type { OptimisticLocalStore } from 'convex/browser';
import type {
  FunctionReference,
  PaginationOptions,
  PaginationResult,
} from 'convex/server';
import { makeFunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';

import {
  insertItemIntoListQuery,
  readDocumentId,
  removeItemFromListQuery,
  updateDocumentQuery,
  updateItemInListQuery,
} from './optimistic-updates';
import {
  removeItemFromPaginatedQuery,
  updateItemInPaginatedQuery,
} from './use-convex-paginated-query';

// Minimal in-memory OptimisticLocalStore for exercising the helpers. The `as`
// escapes are confined to satisfying Convex's generic store interface in tests.
function createFakeStore(): OptimisticLocalStore {
  const data = new Map<FunctionReference<'query'>, Map<string, unknown>>();
  const argKey = (args: unknown) => JSON.stringify(args ?? {});
  return {
    getQuery(query, ...args) {
      return data.get(query)?.get(argKey(args[0]));
    },
    setQuery(query, args, value) {
      const byArgs = data.get(query) ?? new Map<string, unknown>();
      byArgs.set(argKey(args), value);
      data.set(query, byArgs);
    },
    getAllQueries(query) {
      const byArgs = data.get(query);
      if (!byArgs) return [];
      return [...byArgs.entries()].map(([key, value]) => ({
        args: JSON.parse(key),
        value,
      }));
    },
  };
}

const orgArgs = { organizationId: 'org1' };

describe('readDocumentId', () => {
  it('returns the string _id', () => {
    expect(readDocumentId({ _id: 'abc', name: 'x' })).toBe('abc');
  });
  it('returns undefined for non-objects and missing/non-string ids', () => {
    expect(readDocumentId(null)).toBeUndefined();
    expect(readDocumentId('abc')).toBeUndefined();
    expect(readDocumentId({ name: 'x' })).toBeUndefined();
    expect(readDocumentId({ _id: 123 })).toBeUndefined();
  });
});

describe('updateDocumentQuery', () => {
  const query = makeFunctionReference<
    'query',
    typeof orgArgs,
    { _id: string; config: { enabled: boolean } } | null
  >('policies:get');

  it('replaces the value via the updater', () => {
    const store = createFakeStore();
    store.setQuery(query, orgArgs, { _id: 'p1', config: { enabled: false } });
    updateDocumentQuery(store, query, orgArgs, (current) => ({
      ...current,
      config: { enabled: true },
    }));
    expect(store.getQuery(query, orgArgs)).toEqual({
      _id: 'p1',
      config: { enabled: true },
    });
  });

  it('is a no-op when the query is absent', () => {
    const store = createFakeStore();
    updateDocumentQuery(store, query, orgArgs, (current) => current);
    expect(store.getQuery(query, orgArgs)).toBeUndefined();
  });
});

describe('list query helpers', () => {
  const query = makeFunctionReference<
    'query',
    { organizationId: string; status?: string },
    { _id: string; name: string }[]
  >('customers:list');
  const seed = () => {
    const store = createFakeStore();
    store.setQuery(query, orgArgs, [
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
    ]);
    return store;
  };

  it('updateItemInListQuery updates only the matching item', () => {
    const store = seed();
    updateItemInListQuery(store, query, 'b', (item) => ({
      ...item,
      name: 'Beta!',
    }));
    expect(store.getQuery(query, orgArgs)).toEqual([
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta!' },
    ]);
  });

  it('removeItemFromListQuery drops the matching item', () => {
    const store = seed();
    removeItemFromListQuery(store, query, 'a');
    expect(store.getQuery(query, orgArgs)).toEqual([
      { _id: 'b', name: 'Beta' },
    ]);
  });

  it('removeItemFromListQuery spans every loaded filter variant', () => {
    const store = seed();
    store.setQuery(query, { organizationId: 'org1', status: 'active' }, [
      { _id: 'a', name: 'Alpha' },
    ]);
    removeItemFromListQuery(store, query, 'a');
    expect(store.getQuery(query, orgArgs)).toEqual([
      { _id: 'b', name: 'Beta' },
    ]);
    expect(
      store.getQuery(query, { organizationId: 'org1', status: 'active' }),
    ).toEqual([]);
  });

  it('insertItemIntoListQuery adds at start by default and end on request', () => {
    const store = seed();
    insertItemIntoListQuery(store, query, orgArgs, { _id: 'c', name: 'Gamma' });
    expect(store.getQuery(query, orgArgs)).toEqual([
      { _id: 'c', name: 'Gamma' },
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
    ]);
    insertItemIntoListQuery(
      store,
      query,
      orgArgs,
      { _id: 'd', name: 'Delta' },
      'end',
    );
    expect(store.getQuery(query, orgArgs)).toEqual([
      { _id: 'c', name: 'Gamma' },
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Beta' },
      { _id: 'd', name: 'Delta' },
    ]);
  });

  it('is a no-op when the list query is absent', () => {
    const store = createFakeStore();
    removeItemFromListQuery(store, query, 'a');
    updateItemInListQuery(store, query, 'a', (item) => item);
    insertItemIntoListQuery(store, query, orgArgs, { _id: 'z', name: 'Zeta' });
    expect(store.getQuery(query, orgArgs)).toBeUndefined();
  });
});

describe('removeItemFromPaginatedQuery', () => {
  it('removes the item from every loaded page across arg variants', () => {
    const store = createFakeStore();
    const query = makeFunctionReference<'query'>('documents:listPaginated');
    store.setQuery(
      query,
      { organizationId: 'org1', folderId: 'f1' },
      { page: [{ _id: 'a' }, { _id: 'b' }], isDone: false, continueCursor: '' },
    );
    store.setQuery(
      query,
      { organizationId: 'org1', folderId: 'f2' },
      { page: [{ _id: 'b' }, { _id: 'c' }], isDone: true, continueCursor: '' },
    );
    removeItemFromPaginatedQuery(store, query, 'b');
    expect(
      store.getQuery(query, { organizationId: 'org1', folderId: 'f1' }),
    ).toEqual({ page: [{ _id: 'a' }], isDone: false, continueCursor: '' });
    expect(
      store.getQuery(query, { organizationId: 'org1', folderId: 'f2' }),
    ).toEqual({ page: [{ _id: 'c' }], isDone: true, continueCursor: '' });
  });
});

describe('updateItemInPaginatedQuery', () => {
  // A concretely-typed paginated query ref so the update callback's item type
  // resolves to the page element (not `unknown`). `paginationOpts` is part of
  // the args contract for any real paginated query, so it's included here too.
  const pageOpts: PaginationOptions = { numItems: 10, cursor: null };
  type Customer = { _id: string; name: string };
  const paginatedQuery = makeFunctionReference<
    'query',
    {
      paginationOpts: PaginationOptions;
      organizationId: string;
      status?: string;
    },
    PaginationResult<Customer>
  >('customers:listPaginated');

  it('patches the matching item in place, leaving the rest untouched', () => {
    const store = createFakeStore();
    const args = { paginationOpts: pageOpts, organizationId: 'org1' };
    store.setQuery(paginatedQuery, args, {
      page: [
        { _id: 'a', name: 'Alpha' },
        { _id: 'b', name: 'Beta' },
      ],
      isDone: false,
      continueCursor: '',
    });
    updateItemInPaginatedQuery(store, paginatedQuery, 'b', (item) => ({
      ...item,
      name: 'Beta!',
    }));
    expect(store.getQuery(paginatedQuery, args)).toEqual({
      page: [
        { _id: 'a', name: 'Alpha' },
        { _id: 'b', name: 'Beta!' },
      ],
      isDone: false,
      continueCursor: '',
    });
  });

  it('updates the item across every loaded arg variant', () => {
    const store = createFakeStore();
    const activeArgs = {
      paginationOpts: pageOpts,
      organizationId: 'org1',
      status: 'active',
    };
    const archivedArgs = {
      paginationOpts: pageOpts,
      organizationId: 'org1',
      status: 'archived',
    };
    store.setQuery(paginatedQuery, activeArgs, {
      page: [{ _id: 'a', name: 'Alpha' }],
      isDone: true,
      continueCursor: '',
    });
    store.setQuery(paginatedQuery, archivedArgs, {
      page: [{ _id: 'a', name: 'Alpha' }],
      isDone: true,
      continueCursor: '',
    });
    updateItemInPaginatedQuery(store, paginatedQuery, 'a', (item) => ({
      ...item,
      name: 'Renamed',
    }));
    expect(store.getQuery(paginatedQuery, activeArgs)).toEqual({
      page: [{ _id: 'a', name: 'Renamed' }],
      isDone: true,
      continueCursor: '',
    });
    expect(store.getQuery(paginatedQuery, archivedArgs)).toEqual({
      page: [{ _id: 'a', name: 'Renamed' }],
      isDone: true,
      continueCursor: '',
    });
  });

  it('is a no-op when the paginated query is absent', () => {
    const store = createFakeStore();
    updateItemInPaginatedQuery(store, paginatedQuery, 'a', (item) => item);
    expect(
      store.getQuery(paginatedQuery, {
        paginationOpts: pageOpts,
        organizationId: 'org1',
      }),
    ).toBeUndefined();
  });
});
