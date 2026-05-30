import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { GuardrailsOverview } from './guardrails-overview';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({ formatDate: () => 'just now' }),
}));

// Mutable, hoisted so the mock factories can read it. A single `isLoading`
// toggle drives BOTH the three policy reads (status cards) and the events read
// (table), since the overview's loading state covers all of them.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: { enabled: false, config: {} } as
      | Record<string, unknown>
      | undefined,
    events: [] as unknown[],
  },
}));

vi.mock('../hooks/queries', () => ({
  // Same shape for every policyType — the cards just read `enabled`.
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : state.policy,
    isLoading: state.isLoading,
  }),
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: state.isLoading ? undefined : state.events,
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.policy = { enabled: false, config: {} };
  state.events = [];
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
  state.events = [];
}

describe('GuardrailsOverview', () => {
  describe('loaded state', () => {
    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /guardrails overview/i }),
      ).toBeInTheDocument();
    });

    it('renders the real empty-state once events settle with zero rows', () => {
      setLoaded();
      const { container } = render(
        <GuardrailsOverview organizationId="org-1" />,
      );
      // No table rendered for the empty-state — the real "no events" copy is.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
      expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a busy/status region', () => {
      setLoading();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.getAllByRole('status')[0]).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <GuardrailsOverview organizationId="org-1" />,
      );
      // Three placeholder rows in the table shell, NOT the empty-state copy.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /guardrails overview/i }),
      ).toBeInTheDocument();
    });
  });
});
