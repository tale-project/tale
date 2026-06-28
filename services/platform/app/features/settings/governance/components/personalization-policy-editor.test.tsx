import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen } from '@/tests/utils/render';

import { PersonalizationPolicyEditor } from './personalization-policy-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

// Controllable save mutation. `mode: 'defer'` hands the test the in-flight
// promise's resolve/reject so it can assert the optimistic override is visible
// while the save is pending, then settle it; `'resolve'`/`'reject'` complete
// synchronously. Hoisted so the (hoisted) `vi.mock` factory can read it.
const { mutation } = vi.hoisted(() => {
  const m = {
    mode: 'resolve' as 'resolve' | 'reject' | 'defer',
    resolvePending: null as null | (() => void),
    rejectPending: null as null | ((reason?: unknown) => void),
    mutateAsync: vi.fn(),
  };
  m.mutateAsync = vi.fn(() => {
    if (m.mode === 'defer') {
      return new Promise<void>((resolve, reject) => {
        m.resolvePending = resolve;
        m.rejectPending = reject;
      });
    }
    if (m.mode === 'reject') return Promise.reject(new Error('save failed'));
    return Promise.resolve();
  });
  return { mutation: m };
});

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: mutation.mutateAsync,
    isPending: false,
  }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips both toggles between loading and loaded.
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

beforeEach(() => {
  mutation.mode = 'resolve';
  mutation.resolvePending = null;
  mutation.rejectPending = null;
  mutation.mutateAsync.mockClear();
});

describe('PersonalizationPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the real switches (in the a11y tree)', () => {
      setLoaded();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      // One switch per personalization policy toggle.
      expect(screen.getAllByRole('switch')).toHaveLength(2);
    });

    it('renders the section headings (static text, always real)', () => {
      setLoaded();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      expect(screen.getAllByRole('heading')).toHaveLength(2);
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('reflects the server-stored enabled value once loaded', () => {
      // Basic happy-path coverage of the loaded state. (Note: this alone does
      // NOT guard the #2023 regression — RTL's `render()` flushes effects in
      // `act()`, so the old `useState(false)` + `useEffect` mirror would also
      // read `true` here. The derive-contract test below is the real guard.)
      setLoaded();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      for (const toggle of screen.getAllByRole('switch')) {
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      }
    });

    it('shows the optimistic value while saving, then re-derives from server state', async () => {
      // Regression guard for #2023. jsdom can't observe the real pre-paint
      // flash, so we test the observable contract the refactor guarantees:
      // `enabled = pending ?? savedEnabled` is DERIVED from server state, with
      // `pending` only a transient optimistic overlay. The old
      // `useState(false)` + `useEffect(setEnabled)` mirror keeps the toggled
      // value as local state after a successful save, so it would FAIL the
      // final assertion below (it would still show the optimistic value rather
      // than re-reading the unchanged server value).
      setLoaded();
      state.config = { enabled: false };
      mutation.mode = 'defer';

      const { user } = render(
        <PersonalizationPolicyEditor organizationId="org-1" />,
      );
      const [toggle] = screen.getAllByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      await user.click(toggle);
      // In-flight: the optimistic `pending` value overrides the server value.
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);

      // The save succeeds but the server config has NOT changed (the reactive
      // query hasn't caught up / an external revert). Settling drops `pending`,
      // so the toggle re-derives from server state — back to `false`.
      await act(async () => {
        mutation.resolvePending?.();
      });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('reverts the optimistic value when the save fails', async () => {
      setLoaded();
      state.config = { enabled: false };
      mutation.mode = 'reject';

      const { user } = render(
        <PersonalizationPolicyEditor organizationId="org-1" />,
      );
      const [toggle] = screen.getAllByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      await user.click(toggle);
      // `pending` is cleared in `finally`, so the failed toggle re-derives from
      // the (unchanged) server state rather than sticking at the optimistic value.
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a busy/status region per toggle', () => {
      setLoading();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      const regions = screen.getAllByRole('status');
      expect(regions).toHaveLength(2);
      for (const region of regions) {
        expect(region).toHaveAttribute('aria-busy', 'true');
      }
    });

    it('masks the switches (no live switches while loading)', () => {
      setLoading();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      // The skeleton-aware Switch renders a masked box instead of the control.
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('keeps the real section headings while loading (no gray bars)', () => {
      setLoading();
      render(<PersonalizationPolicyEditor organizationId="org-1" />);
      expect(screen.getAllByRole('heading')).toHaveLength(2);
    });
  });
});
