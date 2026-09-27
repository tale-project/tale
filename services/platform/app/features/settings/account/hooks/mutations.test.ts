// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { renderHook } from '@/tests/utils/render';

// Enter in the Name field submits without the header's Save cluster, so the
// save's own toast is all a refused save shows there. It used to be the
// generic "Couldn't finish that action — Try again." whatever the server said.

const useBackendMutation = vi.fn((..._args: unknown[]) => ({
  mutateAsync: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (...args: unknown[]) => useBackendMutation(...args),
}));

import { useUpdateUserName } from './mutations';

interface ErrorToast {
  title: string;
  description: (error: Error) => string | undefined;
}

function errorToastOf(): ErrorToast {
  renderHook(() => useUpdateUserName());
  const options: unknown = useBackendMutation.mock.lastCall?.[1];
  if (
    options === null ||
    typeof options !== 'object' ||
    !('errorToast' in options)
  ) {
    throw new Error('useUpdateUserName passed no errorToast');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shape useBackendMutation takes
  return options.errorToast as ErrorToast;
}

describe('useUpdateUserName', () => {
  it("names the profile save and the server's reason in its toast", () => {
    const errorToast = errorToastOf();
    expect(errorToast.title).toBe("Couldn't update profile");
    expect(
      errorToast.description(
        new AppError({
          code: 'too_long',
          message: 'Name must be 100 characters or less',
        }),
      ),
    ).toBe('Name must be 100 characters or less');
  });

  it('says nothing more for a save that got no answer', () => {
    expect(
      errorToastOf().description(new TypeError('Failed to fetch')),
    ).toBeUndefined();
  });
});
