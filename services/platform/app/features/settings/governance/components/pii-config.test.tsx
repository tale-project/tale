import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { PiiConfig } from './pii-config';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded. The
// PII panel only mounts once `enabled`, so the loaded fixture keeps it off —
// the enable Switch is the data-bearing control under test.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: {
      enabled: false,
      config: { mode: 'tokenize', enabledPatterns: [], customPatterns: [] },
    } as Record<string, unknown> | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : state.policy,
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.policy = {
    enabled: false,
    config: { mode: 'tokenize', enabledPatterns: [], customPatterns: [] },
  };
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
}

describe('PiiConfig', () => {
  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /pii protection/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch while loading)', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      // The masked switch renders as an aria-hidden box → out of the a11y tree.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /pii protection/i }),
      ).toBeInTheDocument();
    });
  });
});
