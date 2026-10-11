// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { VersionHistoryTable } from './version-history-table';

const page = vi.hoisted(() => ({
  results: [] as Array<Record<string, unknown>>,
  error: null as Error | null,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/queries', () => ({
  useAutomationVersionHistory: () => ({
    results: page.results,
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
    error: page.error,
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
    members: [
      { userId: 'user-ada', displayName: 'Ada Lovelace' },
      { userId: 'user-noah', displayName: 'Noah Weber' },
    ],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

function version(n: number, over: Record<string, unknown> = {}) {
  return {
    version: n,
    message: `Change ${n}`,
    createdBy: 'user-ada',
    createdAt: 1_791_000_000_000 + n,
    createdVia: 'app',
    viaInferred: false,
    clientName: null,
    basedOnVersion: n === 1 ? null : n - 1,
    restoredFromVersion: null,
    changes:
      n === 1
        ? { first: true, nodes: { added: 2, removed: 0, changed: 0 } }
        : { nodes: { added: 1, removed: 0, changed: 2 }, tests: true },
    testsPassed: true,
    testsCheckedAt: null,
    tests: null,
    deployed: false,
    lastDeployedAt: null,
    ...over,
  };
}

const deploy = vi.fn();
const onRestore = vi.fn();
const onDownload = vi.fn();

function renderTable(
  props: Partial<Parameters<typeof VersionHistoryTable>[0]> = {},
) {
  return render(
    <VersionHistoryTable
      organizationId="org-1"
      automationSlug="ops/digest"
      canAuthor
      latestVersion={5}
      liveVersion={4}
      deployer={{ deploy }}
      onRestore={onRestore}
      onDownload={onDownload}
      {...props}
    />,
  );
}

function row(name: RegExp) {
  return screen.getByRole('row', { name });
}

beforeEach(() => {
  page.results = [
    version(5, {
      message: 'Restore v2',
      restoredFromVersion: 2,
      basedOnVersion: 2,
      createdBy: 'api-key:user-noah',
      createdVia: 'mcp',
      clientName: 'Claude Code',
      testsPassed: null,
    }),
    version(4, { deployed: true, lastDeployedAt: 1_791_200_000_000 }),
    version(3, {
      message: '',
      basedOnVersion: 1,
      changes: null,
      testsPassed: false,
      lastDeployedAt: 1_791_100_000_000,
    }),
    version(2),
    version(1, { createdBy: 'system:provisioning', createdVia: 'system' }),
  ];
  page.error = null;
  navigate.mockReset();
  deploy.mockReset();
  onRestore.mockReset();
  onDownload.mockReset();
});

describe('VersionHistoryTable', () => {
  it('says which version is live and when another one last was', () => {
    renderTable();
    expect(within(row(/^v4/)).getByText('Live')).toBeVisible();
    expect(within(row(/^v3/)).getByText(/^Last went live /)).toBeVisible();
    expect(within(row(/^v2/)).queryByText(/Last went live|Live/)).toBeNull();
  });

  it('shows each version’s message, its lineage, who saved it and through what', () => {
    renderTable();
    const restored = row(/^v5/);
    expect(within(restored).getByText('Restore v2')).toBeVisible();
    expect(within(restored).getByText('Restores v2')).toBeVisible();
    expect(within(restored).getByText('Noah Weber')).toBeVisible();
    expect(
      within(restored).getByText('with Claude Code through MCP'),
    ).toBeVisible();
    const branched = row(/^v3/);
    // The store keeps a version saved without a message with an empty one.
    expect(within(branched).getByText('No message')).toBeVisible();
    expect(within(branched).getByText('Based on v1')).toBeVisible();
    // Saved on top of the version before it: no word needed.
    expect(within(row(/^v2/)).queryByText(/Based on/)).toBeNull();
    expect(within(row(/^v1/)).getByText('Tale')).toBeVisible();
  });

  it('sums up what each version changed, and how its tests went', () => {
    renderTable();
    const second = row(/^v2/);
    expect(within(second).getByText(/1 added/)).toBeVisible();
    expect(within(second).getByText(/2 changed/)).toBeVisible();
    expect(
      within(second).getByText('Tests', { selector: 'span' }),
    ).toBeVisible();
    expect(within(second).getByText('Passed')).toBeVisible();
    expect(within(row(/^v1/)).getByText('First version')).toBeVisible();
    expect(within(row(/^v3/)).getByText('Not recorded')).toBeVisible();
    expect(within(row(/^v3/)).getByText('Failed')).toBeVisible();
    expect(within(row(/^v5/)).getByText('No result')).toBeVisible();
  });

  it('opens a version in the editor from its row', async () => {
    const { user } = renderTable();
    await user.click(within(row(/^v2/)).getByText('Change 2'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params: { id: 'org-1', automationSlug: 'ops__digest' },
      search: { version: 2 },
    });
  });

  it('rolls back to an older version, deploys a newer one, and restores from the menu', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Actions for v3' }));
    await user.click(screen.getByRole('menuitem', { name: 'Roll back to v3' }));
    // The row's menu button is where a refusal's dialog returns focus.
    expect(deploy).toHaveBeenCalledWith(3, 4, {
      current: screen.getByRole('button', { name: 'Actions for v3' }),
    });

    await user.click(screen.getByRole('button', { name: 'Actions for v5' }));
    // The latest version is restored by nothing: it is the latest.
    expect(
      screen.queryByRole('menuitem', { name: 'Restore as new version' }),
    ).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Deploy v5' }));
    expect(deploy).toHaveBeenLastCalledWith(5, 4, expect.anything());

    await user.click(screen.getByRole('button', { name: 'Actions for v2' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Restore as new version' }),
    );
    expect(onRestore).toHaveBeenCalledWith(2);
  });

  it('offers no deploy on the live row, and only reading to a reader who cannot deploy', async () => {
    const { user, unmount } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Actions for v4' }));
    expect(
      screen.queryByRole('menuitem', { name: /Deploy|Roll back/ }),
    ).toBeNull();
    unmount();
    const second = renderTable({ canAuthor: false });
    await second.user.click(
      screen.getByRole('button', { name: 'Actions for v2' }),
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open in editor', 'Download YAML']);
    await second.user.click(
      screen.getByRole('menuitem', { name: 'Download YAML' }),
    );
    expect(onDownload).toHaveBeenCalledWith(2);
  });

  it('shows a failed read instead of an empty history', () => {
    page.results = [];
    page.error = new Error('offline');
    renderTable();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByText('No versions saved yet.')).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = renderTable();
    await checkAccessibility(container);
  });
});
