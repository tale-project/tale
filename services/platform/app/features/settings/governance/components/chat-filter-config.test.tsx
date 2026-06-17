import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Entry point is exported as `ChatFilterConfigView` (the guardrails route
// imports that name); it is the container that owns the data + Skeletonize.
import { ChatFilterConfigView } from './chat-filter-config';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// Mutable, hoisted so the mock factory can read it. The conditional sections
// only render once `enabled`, so the loaded fixture keeps the filter off — the
// enable Switch is the data-bearing control under test.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: {
      enabled: false,
      config: {
        enabled: false,
        maskReplacement: '[BLOCKED]',
        appliesTo: ['input'],
        configVersion: 1,
        categories: [],
      },
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
    config: {
      enabled: false,
      maskReplacement: '[BLOCKED]',
      appliesTo: ['input'],
      configVersion: 1,
      categories: [],
    },
  };
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
}

describe('ChatFilterConfig', () => {
  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /content safety/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch while loading)', () => {
      setLoading();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<ChatFilterConfigView organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /content safety/i }),
      ).toBeInTheDocument();
    });
  });
});
