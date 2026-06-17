import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DsarPolicyEditor } from './dsar-policy-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useProposeDsarPolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelPendingDsarPolicyChange: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Mutable, hoisted so the mock factory can read it. Toggling `state` flips the
// editor between loading and loaded; the owner can edit so the inputs render
// live (not the read-only-masked variant).
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    data: {
      callerIsOwner: true,
      pending: null,
      config: {
        coolingOffHours: 24,
        requireDualApproval: true,
        dailyLimitPerAdmin: 5,
      },
    } as Record<string, unknown> | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useDsarPolicyForUi: () => ({
    data: state.isLoading ? undefined : state.data,
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.data = {
    callerIsOwner: true,
    pending: null,
    config: {
      coolingOffHours: 24,
      requireDualApproval: true,
      dailyLimitPerAdmin: 5,
    },
  };
}
function setLoading() {
  state.isLoading = true;
  state.data = undefined;
}

describe('DsarPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the real number inputs (in the a11y tree)', () => {
      setLoaded();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    });

    it('renders the real dual-approval switch', () => {
      setLoaded();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /data subject request/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live inputs/switch while loading)', () => {
      setLoading();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<DsarPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /data subject request/i }),
      ).toBeInTheDocument();
    });
  });
});
