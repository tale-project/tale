import { useMutation } from 'convex/react';
import { describe, it, expect } from 'vitest';

import { useConvexMutation } from '../use-convex-mutation';

describe('useConvexMutation', () => {
  it('is the same function as useMutation from convex/react', () => {
    expect(useConvexMutation).toBe(useMutation);
  });
});
