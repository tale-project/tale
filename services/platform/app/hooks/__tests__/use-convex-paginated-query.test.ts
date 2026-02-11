import { usePaginatedQuery } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexPaginatedQuery } from '../use-convex-paginated-query';

describe('useConvexPaginatedQuery', () => {
  it('is the same function as usePaginatedQuery from convex/react', () => {
    expect(useConvexPaginatedQuery).toBe(usePaginatedQuery);
  });
});
