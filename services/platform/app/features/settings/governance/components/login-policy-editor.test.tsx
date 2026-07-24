import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { render, screen } from '@/tests/utils/render';

import { LoginPolicyEditor } from './login-policy-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// Hoisted so the save spy is inspectable across renders (each render must see
// the SAME `mutateAsync`, not a fresh `vi.fn()`) — mirrors `pii-config.test.tsx`.
const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
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
  // `enabled: true` so the batched fields render in the loaded tree.
  state.config = { enabled: true };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('LoginPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the enable switch and the batched number inputs', () => {
      setLoaded();
      render(<LoginPolicyEditor organizationId="org-1" />);
      // Header enable switch.
      expect(screen.getAllByRole('switch')).toHaveLength(1);
      // maxAttempts / backoffSchedule(text) / trustedProxies(text). Only the
      // number field is a spinbutton; the two free-text fields are textboxes.
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(2);
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<LoginPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /login attempt limits/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<LoginPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<LoginPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch/inputs while loading)', () => {
      setLoading();
      render(<LoginPolicyEditor organizationId="org-1" />);
      // The header switch masks to a SkeletonBox (no role=switch); the gated
      // fields are not rendered while `enabled` is false during loading.
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<LoginPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /login attempt limits/i }),
      ).toBeInTheDocument();
    });
  });

  // #2670: the batched form save built its payload from scratch
  // (`{enabled, maxAttemptsBeforeLockout, backoffSchedule, trustedProxies}`),
  // silently dropping any configured `perIpLimit` — while the header toggle's
  // save path already spread the saved config and preserved it.
  describe('form save preserves perIpLimit (#2670)', () => {
    it('keeps a configured perIpLimit when editing and saving max attempts', async () => {
      state.isLoading = false;
      state.config = {
        enabled: true,
        maxAttemptsBeforeLockout: 5,
        backoffSchedule: [1000, 10000, 60000, 600000],
        trustedProxies: ['loopback', 'uniquelocal'],
        perIpLimit: { rate: 10, periodSec: 60 },
      };
      saveMutateAsync.mockClear();

      // The editor saves through the controller it registers with the global
      // settings save bar — capture it and drive the save like the bar would.
      const capture = { current: null as EditorController | null };
      function ActiveProbe() {
        capture.current = useActiveEditor();
        return null;
      }
      const { user } = render(
        <ActiveEditorProvider>
          <ActiveProbe />
          <LoginPolicyEditor organizationId="org-1" />
        </ActiveEditorProvider>,
      );

      const maxAttempts = screen.getByRole('spinbutton');
      await user.clear(maxAttempts);
      await user.type(maxAttempts, '7');

      expect(capture.current?.isDirty).toBe(true);
      await act(async () => {
        await capture.current?.save();
      });

      expect(saveMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          policyType: 'login_policy',
          config: expect.objectContaining({
            maxAttemptsBeforeLockout: 7,
            perIpLimit: { rate: 10, periodSec: 60 },
          }),
        }),
      );
    });
  });
});
