import type { ConvexReactClient } from 'convex/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/convex/_generated/api';

import { primeCachedPaginatedQuery } from './use-cached-paginated-query';

// Every shipped listing is adapted onto the 0.5 backend now, so the prime
// machinery is exercised through a mutable registry stub: empty for the
// Convex-path tests, populated to prove the adapted short-circuit.
const mockPaginatedAdapters = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/app/lib/backend/convex-adapters', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/lib/backend/convex-adapters')
  >()),
  PAGINATED_ADAPTERS: mockPaginatedAdapters,
}));

const LIST = api.contacts.queries.listContactsPaginated;

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

  it('skips priming entirely for an adapted listing', async () => {
    const query = vi.fn().mockResolvedValue({ page: [], isDone: true });
    mockPaginatedAdapters['contacts/queries:listContactsPaginated'] = () =>
      null;
    try {
      await primeCachedPaginatedQuery(
        makeClient(query),
        LIST,
        { organizationId: 'org-prime-4' },
        { initialNumItems: 20 },
      );
      expect(query).not.toHaveBeenCalled();
    } finally {
      delete mockPaginatedAdapters['contacts/queries:listContactsPaginated'];
    }
  });
});
