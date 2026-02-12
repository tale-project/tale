import { useAction } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexAction } from '../use-convex-action';

describe('useConvexAction', () => {
  it('is the same function as useAction from convex/react', () => {
    expect(useConvexAction).toBe(useAction);
  });
});
