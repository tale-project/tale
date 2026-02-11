import { useConvex } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexClient } from '../use-convex-client';

describe('useConvexClient', () => {
  it('is the same function as useConvex from convex/react', () => {
    expect(useConvexClient).toBe(useConvex);
  });
});
