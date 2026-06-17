import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TwoFactorPolicyEditor } from './two-factor-policy-editor';

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
    config: { enforced: true, gracePeriodDays: 7, exemptSsoUsers: true } as
      | Record<string, unknown>
      | undefined,
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
  // `enforced: true` so the grace-period field cluster is interactive.
  state.config = { enforced: true, gracePeriodDays: 7, exemptSsoUsers: true };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('TwoFactorPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the enforce + exempt switches and the grace-period input', () => {
      setLoaded();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      // Header enforce switch + exempt-SSO switch.
      expect(screen.getAllByRole('switch')).toHaveLength(2);
      // Grace-period number field.
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /two-factor authentication/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switches/inputs while loading)', () => {
      setLoading();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      // Switch → SkeletonBox, Input → aria-hidden box.
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<TwoFactorPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /two-factor authentication/i }),
      ).toBeInTheDocument();
    });
  });
});
