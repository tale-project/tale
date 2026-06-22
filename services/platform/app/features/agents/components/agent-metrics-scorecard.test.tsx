import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

// Migrated from the `agent editor depth` E2E "metrics tab: renders the scorecard
// (render-only, no run data)". A freshly-created agent has no runs, so the
// scorecard route renders its KPI grid with zeroed values plus the "no runs"
// empty state. The E2E only asserted the section's primary heading
// (workforce.scorecard.title => "Agent Metrics") and the empty-state copy
// (workforce.scorecard.noRuns => "No runs yet.") — i.e. pure prop/empty-state
// render driven by the (empty) getAgentScorecard payload, not a backend
// round-trip. The single Convex query is mocked to the no-data shape and the
// router param hook is stubbed, so this belongs at the component tier.
//
// jsdom note: the scorecard renders no charts (it is a plain KPI-card grid +
// list), so there is no recharts geometry to reproduce here — the empty-state
// copy the E2E asserted is exactly the "no run data" branch.

// The route file calls createFileRoute(...) at module scope and the component
// reads Route.useParams() for the org/agent ids. Partial-mock the router so the
// real exports stay intact while Route.useParams() returns deterministic ids.
const mockUseParams = vi.fn(() => ({ id: 'org-1', agentId: 'e2e-agent' }));
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => mockUseParams(),
  }),
}));

// getAgentScorecard is the only Convex read the tab makes. Return the no-run
// shape (empty daily rollups + empty recentRuns) so the KPI grid renders zeroed
// values and the "No runs yet." empty state shows — the freshly-created-agent
// case the E2E exercised.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: { daily: [], recentRuns: [] },
    isLoading: false,
  }),
}));

// The route module references api.task_metrics.queries.getAgentScorecard as the
// query key; stub it so the import resolves without the generated Convex api.
vi.mock('@/convex/_generated/api', () => ({
  api: {
    task_metrics: { queries: { getAgentScorecard: 'mock-scorecard-query' } },
  },
}));

async function loadMetricsTab() {
  const mod =
    await import('@/app/routes/dashboard/$id/agents/$agentId/metrics');
  // Our createFileRoute mock returns the config spread directly, so the route
  // component is exposed at `.component` (not `.options.component`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.Route as any).component as React.ComponentType;
}

describe('AgentMetricsTab scorecard (render-only, no run data)', () => {
  it('renders the scorecard heading and the no-runs empty state', async () => {
    const AgentMetricsTab = await loadMetricsTab();

    const { container } = render(<AgentMetricsTab />);

    // workforce.scorecard.title — MetricsLayout renders the title as an <h2>,
    // matching the E2E's getByRole('heading', { name, level: 2 }).
    expect(
      screen.getByRole('heading', { name: 'Agent Metrics', level: 2 }),
    ).toBeInTheDocument();

    // workforce.scorecard.noRuns — the empty-state copy for an agent with no runs.
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();

    await checkAccessibility(container);
  });
});
