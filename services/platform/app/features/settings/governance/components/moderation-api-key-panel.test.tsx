import { describe, expect, it, vi } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';
import { render, screen } from '@/tests/utils/render';

import { ApiKeyPanel } from './moderation-api-key-panel';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Hoisted so the save spy is inspectable across renders (each render must see
// the SAME `mutateAsync`, not a fresh `vi.fn()`) — mirrors
// `pii-config.test.tsx`.
const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveModerationSecret: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useModerationSecretStatus: () => ({ data: null, isLoading: false }),
}));

describe('ApiKeyPanel', () => {
  // #2669: a save failure used to surface the thrown error's raw `.message`
  // (a dev-facing `BackendError`/stacktrace string) as the toast title
  // instead of routing it through `mapGovernanceSaveError` like the rest of
  // the governance editors.
  it('surfaces a localized message (not the raw BackendError) when saving the key fails', async () => {
    toastSpy.mockClear();
    saveMutateAsync.mockRejectedValueOnce(
      new BackendError({
        code: 'ORG_FORBIDDEN',
        message: 'Role "member" cannot modify governance policies.',
      }),
    );

    const { user } = render(
      <ApiKeyPanel organizationId="org-1" disabled={false} />,
    );

    await user.click(screen.getByRole('button', { name: /set key/i }));
    await user.type(screen.getByPlaceholderText(/bearer/i), 'sk-test-123');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(saveMutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      authHeader: 'sk-test-123',
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "You don't have permission to change this setting.",
        variant: 'destructive',
      }),
    );
    const [call] = toastSpy.mock.calls.at(-1) ?? [];
    expect(call?.title).not.toContain('BackendError');
    expect(call?.title).not.toContain('CONVEX');
  });
});
