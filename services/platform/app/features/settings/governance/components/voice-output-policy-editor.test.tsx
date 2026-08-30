import { describe, expect, it, vi } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';
import { render, screen } from '@/tests/utils/render';

import { VoiceOutputPolicyEditor } from './voice-output-policy-editor';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

// Hoisted so tests can drive the `onSuccess`/`onError` callbacks the real
// mutation hook would invoke (mirrors the component's `mutate(args, opts)`
// call shape).
const { mutateSpy } = vi.hoisted(() => ({
  mutateSpy: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutate: mutateSpy, isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true } as Record<string, unknown> | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.config = { enabled: true };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('VoiceOutputPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the real switch (in the a11y tree)', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /voice/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the switch (no live switch while loading)', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      // The skeleton-aware Switch renders a masked box instead of the control.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /voice/i }),
      ).toBeInTheDocument();
    });
  });

  // #2669: a save failure used to surface the thrown error's raw `.message`
  // (a dev-facing `BackendError`/stacktrace string, or an empty description)
  // instead of routing it through `mapGovernanceSaveError`.
  describe('save failure toast (#2669)', () => {
    it('surfaces a localized description (not the raw BackendError, not empty) on save failure', async () => {
      setLoaded();
      toastSpy.mockClear();
      mutateSpy.mockImplementation(
        (_args: unknown, options?: { onError?: (err: unknown) => void }) => {
          options?.onError?.(
            new BackendError({
              code: 'ORG_FORBIDDEN',
              message: 'Role "member" cannot modify governance policies.',
            }),
          );
        },
      );

      const { user } = render(
        <VoiceOutputPolicyEditor organizationId="org-1" />,
      );
      await user.click(screen.getByRole('switch'));

      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "You don't have permission to change this setting.",
          variant: 'destructive',
        }),
      );
      const [call] = toastSpy.mock.calls.at(-1) ?? [];
      expect(call?.description).not.toContain('BackendError');
      expect(call?.description).not.toBeUndefined();
    });
  });
});
