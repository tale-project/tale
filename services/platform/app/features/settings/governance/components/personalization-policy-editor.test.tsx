import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

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

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
