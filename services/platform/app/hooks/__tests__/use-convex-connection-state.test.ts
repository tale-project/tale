import { useConvexConnectionState as original } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexConnectionState } from '../use-convex-connection-state';

describe('useConvexConnectionState', () => {
  it('is the same function as useConvexConnectionState from convex/react', () => {
    expect(useConvexConnectionState).toBe(original);
  });
});
