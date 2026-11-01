// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/tests/utils/render';

// The Run check of the Chat tool status panel says a failed request itself,
// in the status line under its button. The action's own toast would report
// the same failure a second time.

const useBackendAction = vi.fn((..._args: unknown[]) => ({
  mutate: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (...args: unknown[]) => useBackendAction(...args),
}));

import { useRunChatSandboxCheck } from './mutations';

describe('useRunChatSandboxCheck', () => {
  it('keeps its own failure toast quiet', () => {
    renderHook(() => useRunChatSandboxCheck());
    expect(useBackendAction).toHaveBeenLastCalledWith(
      'chat/work_tools:runSandboxCheck',
      { errorToast: false },
    );
  });
});
