import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  FeedbackMetricsPage,
  type FeedbackKind,
} from './feedback-metrics-page';
import type { FeedbackPeriod } from './feedback-period';

// Migrated from the `governance` E2E "feedback: renders the analytics page":
// the e2e only asserted that the feedback analytics heading paints. That is a
// render-only seam (the page reads two Convex queries and lays out cards +
// tables — no persistence, navigation, streaming, or RBAC is exercised by the
// assertion), so it belongs at the component tier. We mock the stats query and
// the recent-feedback paginated query and assert the same heading the e2e did.

type StatsHookResult = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

// Mutable so individual tests can drive the loaded vs empty-org branch.
let statsResult: StatsHookResult = {
  data: null,
  isLoading: false,
  error: null,
};

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => statsResult,
}));

vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: () => ({
    results: [],
    status: 'Exhausted' as const,
    loadMore: vi.fn(),
    isLoading: false,
  }),
}));

// The DataTable inside the top-N tables reads the org id from the router; we
// render outside a RouterProvider, so feed it a static id.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// A fully-populated stats fixture so the main (loaded, non-empty) layout
// renders — the same layout the e2e hit against a backend with feedback rows.
const loadedStats = {
  hasAnyFeedback: true,
  capped: false,
  scanned: 3,
  windowStartMs: null,
  message: {
    byRating: { positive: 2, negative: 1 },
    total: 3,
  },
  arena: {
    byVerdict: { a_better: 1, b_better: 0, tie: 0, both_bad: 0 },
    total: 1,
  },
  topAgents: [{ agentSlug: 'support', positive: 2, negative: 1, total: 3 }],
  topModels: [
    {
      provider: 'openrouter',
      model: 'anthropic/claude',
      positive: 2,
      negative: 0,
      total: 2,
    },
  ],
  topMatchups: [],
};

const baseProps = {
  organizationId: 'org-1',
  period: '7' as FeedbackPeriod,
  kind: 'all' as FeedbackKind,
  withCommentOnly: false,
  onChangePeriod: vi.fn(),
  onChangeKind: vi.fn(),
  onToggleCommentOnly: vi.fn(),
  onSelectAgent: vi.fn(),
  onSelectModel: vi.fn(),
  onClearFilters: vi.fn(),
};

describe('FeedbackMetricsPage', () => {
  it('renders the feedback analytics heading on the loaded page', () => {
    statsResult = { data: loadedStats, isLoading: false, error: null };

    render(<FeedbackMetricsPage {...baseProps} />);

    expect(
      screen.getByRole('heading', { name: 'Feedback Metrics' }),
    ).toBeInTheDocument();
  });

  it('still renders the heading on the empty-org teaching panel', () => {
    statsResult = {
      data: { ...loadedStats, hasAnyFeedback: false },
      isLoading: false,
      error: null,
    };

    render(<FeedbackMetricsPage {...baseProps} />);

    expect(
      screen.getByRole('heading', { name: 'Feedback Metrics' }),
    ).toBeInTheDocument();
  });
});
