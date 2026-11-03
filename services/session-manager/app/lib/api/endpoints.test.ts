import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeApi, list } from '@/tests/utils/fake-api';
import { proxy, session } from '@/tests/utils/fixtures';

import { MAX_PAGE, proxiesApi, sessionsApi } from './endpoints';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `count` sessions numbered `count..1`, as the server answers them (newest first). */
function table(count: number) {
  const rows = Array.from({ length: count }, (_value, index) =>
    session({ id: count - index }),
  );
  return ({ query }: { query: URLSearchParams }) => {
    const before = Number(query.get('before') ?? Infinity);
    const minId = Number(query.get('minId') ?? 0);
    const limit = Number(query.get('limit') ?? count);
    return list(
      rows.filter((row) => row.id < before && row.id >= minId).slice(0, limit),
      count,
    );
  };
}

describe('a window of a list', () => {
  it('is one request while it fits the server page', async () => {
    const api = installFakeApi({ 'GET /sessions': table(30) });
    const result = await sessionsApi.list({ limit: 50 });
    expect(result.items).toHaveLength(30);
    expect(result.total).toBe(30);
    expect(api.callsTo('GET /sessions')).toHaveLength(1);
    expect(api.calls[0]?.query.get('limit')).toBe('50');
  });

  it('is assembled from pages by the id each starts below when it is larger', async () => {
    const api = installFakeApi({ 'GET /sessions': table(1300) });
    const result = await sessionsApi.list({ limit: 1100 });

    expect(result.items).toHaveLength(1100);
    expect(result.total).toBe(1300);
    // Newest first, no row twice, none skipped.
    const ids = result.items.map((row) => row.id);
    expect(ids[0]).toBe(1300);
    expect(ids.at(-1)).toBe(201);
    expect(new Set(ids).size).toBe(1100);
    expect(
      api.calls.map((call) => [
        call.query.get('limit'),
        call.query.get('before'),
      ]),
    ).toEqual([
      [String(MAX_PAGE), null],
      [String(MAX_PAGE), '801'],
      ['100', '301'],
    ]);
  });

  describe('read back to an id', () => {
    it('asks for no row older than minId, in one request when they fit the server page', async () => {
      const api = installFakeApi({ 'GET /sessions': table(253) });

      const result = await sessionsApi.list({ limit: 253, minId: 38 });

      // Newest first, down to the id asked for, and the size of the whole list.
      expect(result.items).toHaveLength(216);
      expect(result.items[0]?.id).toBe(253);
      expect(result.items.at(-1)?.id).toBe(38);
      expect(result.total).toBe(253);
      expect(
        api.calls.map((call) => [
          call.query.get('limit'),
          call.query.get('minId'),
        ]),
      ).toEqual([['253', '38']]);
    });

    it('keeps minId on every page of a window larger than the server page, and stops at the short one', async () => {
      const api = installFakeApi({ 'GET /sessions': table(1300) });

      const result = await sessionsApi.list({ limit: 1300, minId: 200 });

      expect(result.items).toHaveLength(1101);
      expect(result.items.at(-1)?.id).toBe(200);
      expect(
        api.calls.map((call) => [
          call.query.get('limit'),
          call.query.get('before'),
          call.query.get('minId'),
        ]),
      ).toEqual([
        [String(MAX_PAGE), null, '200'],
        [String(MAX_PAGE), '801', '200'],
        ['300', '301', '200'],
      ]);
    });

    it('does not ask again once a page came back short: nothing older than minId is left', async () => {
      const api = installFakeApi({ 'GET /sessions': table(120) });

      const result = await sessionsApi.list({ limit: 300, minId: 100 });

      expect(result.items).toHaveLength(21);
      expect(api.callsTo('GET /sessions')).toHaveLength(1);
    });
  });

  it('stops at the end of the list', async () => {
    const api = installFakeApi({
      'GET /proxies': () => list([proxy({ id: 2 }), proxy({ id: 1 })]),
    });
    const result = await proxiesApi.list({ limit: 2000 });
    expect(result.items).toHaveLength(2);
    expect(api.callsTo('GET /proxies')).toHaveLength(1);
  });

  it('stops when a page comes back empty, whatever the total says', async () => {
    installFakeApi({
      'GET /sessions': ({ query }) =>
        query.get('before') === null
          ? list([session({ id: 5 })], 99)
          : list([], 99),
    });
    const result = await sessionsApi.list({ limit: 600 });
    expect(result.items).toHaveLength(1);
  });
});
