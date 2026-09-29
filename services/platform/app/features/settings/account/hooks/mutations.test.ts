// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/tests/utils/render';

// The profile form reports a refused save itself, naming why: its Save
// cluster raises the one toast, and so does its own submit for Enter in the
// field. The write's own toast used to report the same failure a second
// time, under the same title.

const useBackendMutation = vi.fn((..._args: unknown[]) => ({
  mutateAsync: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (...args: unknown[]) => useBackendMutation(...args),
}));

import { useUpdateUserName } from './mutations';

describe('useUpdateUserName', () => {
  it('keeps its own failure toast quiet', () => {
    renderHook(() => useUpdateUserName());
    expect(useBackendMutation).toHaveBeenLastCalledWith(
      'users/mutations:updateUserName',
      { errorToast: false },
    );
  });
});
