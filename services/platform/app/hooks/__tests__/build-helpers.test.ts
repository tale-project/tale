import { QueryClient } from '@tanstack/react-query';
import { describe, it, expect, beforeEach } from 'vitest';

import { buildHelpers } from '../use-convex-optimistic-mutation';

type CacheItem = Record<string, unknown> & { _id: string };

const QUERY_KEY = ['test', 'items'];

function assertDefined<T>(val: T | undefined | null): asserts val is T {
  expect(val).toBeDefined();
}

function createQueryClient(initial?: CacheItem[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initial) {
    qc.setQueryData(QUERY_KEY, initial);
  }
  return qc;
}

function getCache(qc: QueryClient): CacheItem[] | undefined {
  return qc.getQueryData<CacheItem[]>(QUERY_KEY);
}

describe('buildHelpers', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = createQueryClient();
  });

  describe('with undefined queryKey', () => {
    it('returns undefined for all helpers', async () => {
      const helpers = buildHelpers(qc, undefined);

      expect(await helpers.insert({ name: 'x' })).toBeUndefined();
      expect(await helpers.remove('id-1')).toBeUndefined();
      expect(await helpers.update('id-1', { name: 'y' })).toBeUndefined();
      expect(await helpers.bulkUpdate(['id-1'], { name: 'y' })).toBeUndefined();
      expect(await helpers.toggle('id-1', 'active')).toBeUndefined();
    });
  });

  describe('insert', () => {
    it('appends item with a temp id to the cache', async () => {
      qc = createQueryClient([]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.insert({ name: 'New item' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache).toHaveLength(1);
      expect(cache[0].name).toBe('New item');
      expect(cache[0]._id).toMatch(/^__optimistic_/);
    });

    it('returns context with previous state and tempId', async () => {
      const initial = [{ _id: 'existing', name: 'Old' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.insert({ name: 'New' });

      assertDefined(ctx);
      expect(ctx.previous).toEqual(initial);
      expect(ctx.queryKey).toEqual(QUERY_KEY);
      expect(ctx.tempId).toMatch(/^__optimistic_/);
    });

    it('assigns unique temp ids across multiple inserts', async () => {
      qc = createQueryClient([]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx1 = await helpers.insert({ name: 'First' });
      const ctx2 = await helpers.insert({ name: 'Second' });

      assertDefined(ctx1);
      assertDefined(ctx2);
      expect(ctx1.tempId).not.toBe(ctx2.tempId);
      expect(getCache(qc)).toHaveLength(2);
    });

    it('tempId is not overwritten when item contains _id', async () => {
      qc = createQueryClient([]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.insert({
        _id: 'user-provided-id',
        name: 'Test',
      });

      assertDefined(ctx);
      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0]._id).toBe(ctx.tempId);
      expect(cache[0]._id).not.toBe('user-provided-id');
    });

    it('initializes cache when no prior data exists', async () => {
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.insert({ name: 'First ever' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache).toHaveLength(1);
      expect(cache[0].name).toBe('First ever');
    });
  });

  describe('remove', () => {
    it('removes item by id', async () => {
      qc = createQueryClient([
        { _id: 'a', name: 'Alice' },
        { _id: 'b', name: 'Bob' },
      ]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.remove('a');

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache).toHaveLength(1);
      expect(cache[0]._id).toBe('b');
    });

    it('returns context with previous state', async () => {
      const initial = [{ _id: 'a', name: 'Alice' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.remove('a');

      assertDefined(ctx);
      expect(ctx.previous).toEqual(initial);
    });

    it('does nothing when id is not found', async () => {
      const initial = [{ _id: 'a', name: 'Alice' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.remove('nonexistent');

      expect(getCache(qc)).toEqual(initial);
    });
  });

  describe('update', () => {
    it('updates item by id with changes', async () => {
      qc = createQueryClient([{ _id: 'a', name: 'Alice', role: 'admin' }]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.update('a', { role: 'member' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0]).toEqual({ _id: 'a', name: 'Alice', role: 'member' });
    });

    it('returns context with previous state', async () => {
      const initial = [{ _id: 'a', name: 'Alice', role: 'admin' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.update('a', { role: 'member' });

      assertDefined(ctx);
      expect(ctx.previous).toEqual(initial);
    });

    it('does not modify other items', async () => {
      qc = createQueryClient([
        { _id: 'a', name: 'Alice' },
        { _id: 'b', name: 'Bob' },
      ]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.update('a', { name: 'Alicia' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[1]).toEqual({ _id: 'b', name: 'Bob' });
    });
  });

  describe('bulkUpdate', () => {
    it('updates multiple items by ids', async () => {
      qc = createQueryClient([
        { _id: 'a', status: 'open' },
        { _id: 'b', status: 'open' },
        { _id: 'c', status: 'open' },
      ]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.bulkUpdate(['a', 'c'], { status: 'closed' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0].status).toBe('closed');
      expect(cache[1].status).toBe('open');
      expect(cache[2].status).toBe('closed');
    });

    it('returns context with previous state', async () => {
      const initial = [
        { _id: 'a', status: 'open' },
        { _id: 'b', status: 'open' },
      ];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.bulkUpdate(['a', 'b'], { status: 'closed' });

      assertDefined(ctx);
      expect(ctx.previous).toEqual(initial);
    });
  });

  describe('toggle', () => {
    it('toggles a boolean field', async () => {
      qc = createQueryClient([{ _id: 'a', isActive: true }]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.toggle('a', 'isActive');

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0].isActive).toBe(false);
    });

    it('toggles false to true', async () => {
      qc = createQueryClient([{ _id: 'a', isActive: false }]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      await helpers.toggle('a', 'isActive');

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0].isActive).toBe(true);
    });

    it('returns context with previous state', async () => {
      const initial = [{ _id: 'a', isActive: true }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.toggle('a', 'isActive');

      assertDefined(ctx);
      expect(ctx.previous).toEqual(initial);
    });
  });

  describe('insert then update (chaining)', () => {
    it('can update an optimistically inserted item using tempId', async () => {
      qc = createQueryClient([]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const insertCtx = await helpers.insert({
        name: 'Draft',
        status: 'pending',
      });
      assertDefined(insertCtx);
      await helpers.update(insertCtx.tempId, { status: 'active' });

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache).toHaveLength(1);
      expect(cache[0]._id).toBe(insertCtx.tempId);
      expect(cache[0].name).toBe('Draft');
      expect(cache[0].status).toBe('active');
    });

    it('insert context captures pre-insert state for full rollback', async () => {
      const initial = [{ _id: 'existing', name: 'Existing' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const insertCtx = await helpers.insert({ name: 'New' });
      assertDefined(insertCtx);
      await helpers.update(insertCtx.tempId, { name: 'Updated New' });

      qc.setQueryData(insertCtx.queryKey, insertCtx.previous);

      expect(getCache(qc)).toEqual(initial);
    });

    it('can remove an optimistically inserted item using tempId', async () => {
      qc = createQueryClient([{ _id: 'existing', name: 'Existing' }]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const insertCtx = await helpers.insert({ name: 'Temporary' });
      assertDefined(insertCtx);
      expect(getCache(qc)).toHaveLength(2);

      await helpers.remove(insertCtx.tempId);
      expect(getCache(qc)).toHaveLength(1);
      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0]._id).toBe('existing');
    });

    it('can toggle a field on an optimistically inserted item', async () => {
      qc = createQueryClient([]);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const insertCtx = await helpers.insert({
        name: 'Webhook',
        isActive: false,
      });
      assertDefined(insertCtx);
      await helpers.toggle(insertCtx.tempId, 'isActive');

      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0].isActive).toBe(true);
    });
  });

  describe('rollback', () => {
    it('restores previous state when rolling back after insert', async () => {
      const initial = [{ _id: 'a', name: 'Alice' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.insert({ name: 'Optimistic' });
      expect(getCache(qc)).toHaveLength(2);

      assertDefined(ctx);
      qc.setQueryData(ctx.queryKey, ctx.previous);
      expect(getCache(qc)).toEqual(initial);
    });

    it('restores previous state when rolling back after update', async () => {
      const initial = [{ _id: 'a', name: 'Alice', role: 'admin' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.update('a', { role: 'member' });
      const cache = getCache(qc);
      assertDefined(cache);
      expect(cache[0].role).toBe('member');

      assertDefined(ctx);
      qc.setQueryData(ctx.queryKey, ctx.previous);
      expect(getCache(qc)).toEqual(initial);
    });

    it('restores previous state when rolling back after remove', async () => {
      const initial = [{ _id: 'a', name: 'Alice' }];
      qc = createQueryClient(initial);
      const helpers = buildHelpers(qc, QUERY_KEY);

      const ctx = await helpers.remove('a');
      expect(getCache(qc)).toHaveLength(0);

      assertDefined(ctx);
      qc.setQueryData(ctx.queryKey, ctx.previous);
      expect(getCache(qc)).toEqual(initial);
    });
  });
});
