import { useConvexAuth as original } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexAuth } from '../use-convex-auth';

describe('useConvexAuth', () => {
  it('is the same function as useConvexAuth from convex/react', () => {
    expect(useConvexAuth).toBe(original);
  });
});
