// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { DeploymentHistoryTable } from './deployment-history-table';

const page = vi.hoisted(() => ({
  results: [] as Array<Record<string, unknown>>,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/queries', () => ({
  useAutomationDeployments: () => ({
    results: page.results,
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    errorCount: 0,
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => navigate,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'user-noah', displayName: 'Noah Weber' }],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

function deployment(
  id: string,
  version: number,
  previousVersion: number | null,
  kind: 'deploy' | 'rollback' | 'recorded',
  over: Record<string, unknown> = {},
) {
  return {
    id,
    version,
    previousVersion,
    kind,
    synthesized: false,
    deployedAt: 1_791_000_000_000,
    deployedBy: 'user-me',
    via: 'app',
    clientName: null,
    ...over,
  };
}

const deploy = vi.fn();

function renderTable(canAuthor = true) {
  return render(
    <DeploymentHistoryTable
      organizationId="org-1"
      automationSlug="ops/digest"
      projectId="proj-1"
      canAuthor={canAuthor}
      liveVersion={3}
      deployer={{ deploy }}
    />,
  );
}

beforeEach(() => {
  page.results = [
    deployment('e-3', 3, 5, 'rollback'),
    deployment('e-2', 5, 4, 'deploy', {
      deployedBy: 'api-key:user-noah',
      via: 'mcp',
      clientName: 'Claude Code',
    }),
    deployment('e-1', 4, null, 'recorded', { synthesized: true }),
  ];
  navigate.mockReset();
  deploy.mockReset();
});

describe('DeploymentHistoryTable', () => {
  it('says what went live, what it replaced and who put it live', () => {
    renderTable();
    const rollback = screen.getByRole('row', { name: /Rolled back to v3/ });
    expect(within(rollback).getByText('v5')).toBeVisible();
    expect(within(rollback).getByText('You')).toBeVisible();
    const deployed = screen.getByRole('row', { name: /Deployed v5/ });
    expect(within(deployed).getByText('Noah Weber')).toBeVisible();
    expect(
      within(deployed).getByText('with Claude Code through MCP'),
    ).toBeVisible();
    const recorded = screen.getByRole('row', { name: /v4 was live/ });
    expect(
      within(recorded).getByText('Recorded before the history started.'),
    ).toBeVisible();
    expect(within(recorded).getByText('—')).toBeVisible();
  });

  it('puts a version live again from its row, never the live one', async () => {
    const { user } = renderTable();
    await user.click(
      screen.getByRole('button', {
        name: 'Actions for the deployment of v5',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Deploy v5' }));
    expect(deploy).toHaveBeenCalledWith(5, 3, {
      current: screen.getByRole('button', {
        name: 'Actions for the deployment of v5',
      }),
    });
    await user.click(
      screen.getByRole('button', {
        name: 'Actions for the deployment of v3',
      }),
    );
    expect(
      screen.queryByRole('menuitem', { name: /Deploy|Roll back/ }),
    ).toBeNull();
    // Opened under the project the page is shown in.
    await user.click(screen.getByRole('menuitem', { name: 'Open in editor' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params: {
        id: 'org-1',
        projectId: 'proj-1',
        automationSlug: 'ops__digest',
      },
      search: { version: 3 },
    });
  });

  it('passes an axe audit', async () => {
    const { container } = renderTable(false);
    await checkAccessibility(container);
  });
});
