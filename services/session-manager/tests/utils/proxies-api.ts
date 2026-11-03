import type { Proxy } from '@/lib/api/schemas';

import { list, type FakeRequest } from './fake-api';

/**
 * `GET /proxies` over a pool the test owns (it may change it between polls):
 * newest first, `limit` rows, the ids below `before`, and the size of the
 * whole pool as `X-Total-Count`, as the real route answers.
 */
export function proxyPool(rows: () => readonly Proxy[]) {
  return ({ query }: FakeRequest) => {
    const all = rows();
    const limit = Number(query.get('limit') ?? all.length);
    const before = query.get('before');
    const page = [...all]
      .sort((a, b) => b.id - a.id)
      .filter((row) => before === null || row.id < Number(before))
      .slice(0, limit);
    return list(page, all.length);
  };
}
