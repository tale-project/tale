import { describe, expect, it, vi } from 'vitest';

import { primeCachedPaginatedQuery } from './use-cached-paginated-query';

const LIST = 'contacts/queries:listContactsPaginated';

/**
 * The prime helper is a no-op now: an adapted listing's pages live in
 * react-query, whose cache the component reads on mount, so there is nothing
 * for a loader to warm here. The contract that still matters is that it never
 * throws and never reaches for a client — a loader must not be the thing that
 * breaks a navigation.
 */
describe('primeCachedPaginatedQuery', () => {
  it('resolves without touching any client', async () => {
    const client = { query: vi.fn() };

    await expect(
      primeCachedPaginatedQuery(
        client,
        LIST,
        { organizationId: 'org-prime-1' },
        { initialNumItems: 20 },
      ),
    ).resolves.toBeUndefined();

    expect(client.query).not.toHaveBeenCalled();
  });
});
