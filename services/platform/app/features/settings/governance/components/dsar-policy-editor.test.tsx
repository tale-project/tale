import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DsarPolicyEditor } from './dsar-policy-editor';

const { toast, propose } = vi.hoisted(() => ({
  toast: vi.fn(),
  propose: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('../hooks/mutations', () => ({
  useProposeDsarPolicy: () => ({ mutateAsync: propose, isPending: false }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    propose.mockResolvedValue({ applied: false });
    setLoaded();
  });

  describe('numeric blur validation', () => {
    it.each([
      [
        'Cooling-off window (hours)',
        24,
        'Cooling-off window must be a whole number between 0 and 72.',
      ],
      [
        'Daily limit per admin',
        5,
        'Daily limit must be a whole number between 1 and 50.',
      ],
    ])(
      'restores a cleared %s without proposing a policy',
      async (label, current, message) => {
        const { user } = render(<DsarPolicyEditor organizationId="org-1" />);
        const input = screen.getByRole('spinbutton', { name: label });

        await user.clear(input);
        await user.tab();

        expect(input).toHaveValue(current);
        expect(propose).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledExactlyOnceWith({
          title: message,
          variant: 'destructive',
        });
      },
    );

    it('proposes explicitly typed zero cooling-off hours', async () => {
      const { user } = render(<DsarPolicyEditor organizationId="org-1" />);
      const input = screen.getByRole('spinbutton', {
        name: 'Cooling-off window (hours)',
      });

      await user.clear(input);
      await user.type(input, '0');
      await user.tab();

      expect(input).toHaveValue(0);
      expect(propose).toHaveBeenCalledExactlyOnceWith({
        organizationId: 'org-1',
        config: {
          coolingOffHours: 0,
          requireDualApproval: true,
          dailyLimitPerAdmin: 5,
        },
      });
      expect(toast).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ variant: 'success' }),
      );
    });

    it('does not propose an unchanged cooling-off value on blur', async () => {
      const { user } = render(<DsarPolicyEditor organizationId="org-1" />);
      await user.click(
        screen.getByRole('spinbutton', { name: 'Cooling-off window (hours)' }),
      );
      await user.tab();

      expect(propose).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });
  });

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
