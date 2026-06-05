import type { ConvexReactClient } from 'convex/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/convex/_generated/api';

import { primeCachedPaginatedQuery } from './use-cached-paginated-query';

const LIST = api.customers.queries.listCustomersPaginated;

// Expose the mock fn separately so assertions don't reference an unbound method.
function makeClient(query: ReturnType<typeof vi.fn>): ConvexReactClient {
  return { query } as unknown as ConvexReactClient;
}

describe('primeCachedPaginatedQuery', () => {
  it('fetches page 0 with injected paginationOpts and resolves', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ page: [{ _id: 'a' }], isDone: true });

    await primeCachedPaginatedQuery(
      makeClient(query),
      LIST,
      { organizationId: 'org-prime-1' },
      { initialNumItems: 20 },
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(LIST, {
      organizationId: 'org-prime-1',
      paginationOpts: { numItems: 20, cursor: null },
    });
  });

  it('skips the fetch when the same key is already cached', async () => {
    const query = vi.fn().mockResolvedValue({ page: [], isDone: true });
    const args = { organizationId: 'org-prime-2' };

    await primeCachedPaginatedQuery(makeClient(query), LIST, args, {
      initialNumItems: 20,
    });
    await primeCachedPaginatedQuery(makeClient(query), LIST, args, {
      initialNumItems: 20,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('swallows query errors instead of rejecting', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      primeCachedPaginatedQuery(
        makeClient(query),
        LIST,
        { organizationId: 'org-prime-3' },
        { initialNumItems: 20 },
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
