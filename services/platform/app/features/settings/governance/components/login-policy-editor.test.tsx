import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { LoginPolicyEditor } from './login-policy-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
});
