import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { PasswordPolicyEditor } from './password-policy-editor';

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
    // Empty config → schema defaults (require* = true, rotationDays = 0 so the
    // rotation toggle is off and the rotationDays input stays hidden).
    config: {} as Record<string, unknown> | undefined,
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
  state.config = {};
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('PasswordPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the real checkboxes, the rotation switch, and the min-length input', () => {
      setLoaded();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      // requireUpper/Lower/Digit/Special.
      expect(screen.getAllByRole('checkbox')).toHaveLength(4);
      // The rotation enable switch.
      expect(screen.getAllByRole('switch')).toHaveLength(1);
      // minLength number field (rotationDays input is hidden while rotation
      // is off, so exactly one spinbutton).
      expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /password policy/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live checkboxes/switch/inputs while loading)', () => {
      setLoading();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      // Checkbox → SkeletonBox, Switch → SkeletonBox, Input → aria-hidden box.
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<PasswordPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /password policy/i }),
      ).toBeInTheDocument();
    });
  });
});
