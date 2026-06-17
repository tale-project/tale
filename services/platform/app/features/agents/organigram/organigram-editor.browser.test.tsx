import { SectionHeader } from '@tale/ui/section-header';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OrgChartNode } from '@/convex/agents/org_chart_actions';
import { useT } from '@/lib/i18n/client';
import { render } from '@/tests/utils/render';

import { OrganigramCanvas } from './organigram-canvas';

/**
 * REAL Chromium (project `browser`) component test migrated from the
 * `agent editor` E2E "delegation tab: renders the organigram editor
 * (render-only)".
 *
 * The delegation tab IS the org-chart editor: it renders a `SectionHeader`
 * ("Delegation") above the React Flow `OrganigramCanvas`. The E2E asserted two
 * pure-client render facts — the section's level-2 heading and that the React
 * Flow canvas chrome mounted (the corner "Reset view" control) — neither of
 * which is a backend round-trip. It lives in the browser tier rather than
 * jsdom because React Flow needs real layout / `getBoundingClientRect` to
 * mount its viewport + corner controls, which jsdom cannot provide.
 *
 * The org-chart action query is mocked to a small fixture graph so the canvas
 * renders nodes (instead of the empty state), exactly mirroring the E2E's
 * seeded-org case. No persistence, navigation, or streaming is exercised.
 */

// The org-chart payload the delegation tab reads. Mock the feature hook so the
// canvas gets a non-empty graph without the Convex action backend.
const CHART_NODES: OrgChartNode[] = [
  {
    slug: 'orchestrator',
    displayName: 'Orchestrator',
    directReports: ['researcher'],
    parentSlugs: [],
    budgetPaused: false,
    running: 0,
    hasWarning: false,
  },
  {
    slug: 'researcher',
    displayName: 'Researcher',
    directReports: [],
    parentSlugs: ['orchestrator'],
    managerSlug: 'orchestrator',
    budgetPaused: false,
    running: 0,
    hasWarning: false,
  },
];

vi.mock('./hooks', () => ({
  useOrgChart: () => ({
    chart: { nodes: CHART_NODES, warnings: [] },
    isLoading: false,
    error: undefined,
    refetch: vi.fn(async () => ({
      data: { nodes: CHART_NODES, warnings: [] },
    })),
  }),
}));

// The canvas wires a Convex action for the (untriggered here) save path; stub
// it so the import resolves without the generated Convex api / a live backend.
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    agents: {
      org_chart_actions: {
        getOrgChart: 'mock-get-org-chart',
        setAgentDelegates: 'mock-set-agent-delegates',
      },
    },
  },
}));

/**
 * Harness mirroring the delegation route component (`DelegationTab`): the
 * `SectionHeader` the E2E asserted by its level-2 heading, above the real
 * `OrganigramCanvas`. The render-only assertions (heading + the canvas's
 * corner "Reset view" control) are independent of the editing affordances, so:
 *
 *  - No `focusSlug`: it would pre-select a node and mount the side panel, whose
 *    "open agent" `<Link>` needs a TanStack `RouterProvider` out of scope here.
 *  - `canEdit={false}`: the edit-only `CreateAgentDialog` (which calls
 *    `useQueryClient` at render) and the dirty-state save Panel are then not
 *    mounted. The E2E gated none of its assertions on these — it only checked
 *    the canvas mounted — so this stays faithful to what it asserted.
 */
function DelegationHarness() {
  const { t } = useT('settings');
  return (
    <>
      <SectionHeader
        title={t('agents.delegation.title')}
        description={t('agents.delegation.description')}
      />
      <OrganigramCanvas organizationId="org-1" canEdit={false} />
    </>
  );
}

describe('Organigram delegation editor (real browser)', () => {
  it('renders the delegation section heading and the React Flow canvas chrome', async () => {
    render(<DelegationHarness />);

    // The section's primary heading (settings.agents.delegation.title).
    expect(
      screen.getByRole('heading', { name: 'Delegation', level: 2 }),
    ).toBeInTheDocument();

    // React Flow's corner controls' "Reset view" button is the stable signal
    // that the canvas mounted — exactly the E2E's canvas-mounted probe. It
    // renders inside <ReactFlow> once the viewport is up, so wait for it.
    expect(
      await screen.findByRole('button', { name: 'Reset view' }),
    ).toBeInTheDocument();
  });
});
