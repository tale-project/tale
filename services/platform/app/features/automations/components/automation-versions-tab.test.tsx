// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationVersionsTab } from './automation-versions-tab';

const ensure = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
/** The automation's read, and the member directory's — what the real
 * `useMembers` reads — each answered or failed by a test. */
const reads = vi.hoisted(() => ({
  automation: {} as Record<string, unknown>,
  members: {} as Record<string, unknown>,
}));
const refetch = vi.hoisted(() => ({ automation: vi.fn(), members: vi.fn() }));

/** A read that answered. */
const answered = (data: unknown, again: () => void) => ({
  data,
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  errorUpdateCount: 0,
  refetch: again,
});
/** A read that never answered: a 500 the retry policy gave up on. */
const failed = (again: () => void) => ({
  data: undefined,
  isPending: false,
  isLoading: false,
  isError: true,
  error: new BackendApiError(500, 'Internal Server Error'),
  isFetching: false,
  errorUpdateCount: 1,
  refetch: again,
});

function version(n: number, over: Record<string, unknown> = {}) {
  return {
    version: n,
    message: `Change ${n}`,
    createdBy: 'user-me',
    createdAt: 1_791_000_000_000 + n,
    createdVia: 'app',
    viaInferred: false,
    clientName: null,
    basedOnVersion: n === 1 ? null : n - 1,
    restoredFromVersion: null,
    changes: { nodes: { added: 0, removed: 0, changed: 1 } },
    testsPassed: true,
    testsCheckedAt: null,
    tests: null,
    deployed: n === 2,
    lastDeployedAt: n === 2 ? 1_791_000_000_100 : null,
    ...over,
  };
}

const paginated = (results: unknown[]) => ({
  results,
  status: 'Exhausted',
  isLoading: false,
  loadMore: vi.fn(),
  error: null,
  retry: vi.fn(),
  isRetrying: false,
  unavailable: false,
  errorCount: 0,
});

vi.mock('../hooks/queries', () => ({
  useAutomation: () => reads.automation,
  useAutomationLiveDeployment: () => ({
    isPending: false,
    isError: false,
    data: {
      live: {
        version: 2,
        deployedAt: 1_791_000_000_100,
        deployedBy: 'user-me',
        via: 'app',
        clientName: null,
        activeRuns: 0,
      },
      deployments: [
        {
          id: 'e-2',
          version: 2,
          previousVersion: 1,
          kind: 'deploy',
          synthesized: false,
          deployedAt: 1_791_000_000_100,
          deployedBy: 'user-me',
          via: 'app',
          clientName: null,
        },
      ],
      nextBefore: null,
    },
  }),
  useAutomationVersionHistory: () =>
    paginated([
      version(3),
      version(2),
      // Saved by another member, whom only the directory can name.
      version(1, { createdBy: 'user-ada' }),
    ]),
  useAutomationDeployments: () =>
    paginated([
      {
        id: 'e-2',
        version: 2,
        previousVersion: 1,
        kind: 'deploy',
        synthesized: false,
        deployedAt: 1_791_000_000_100,
        deployedBy: 'user-me',
        via: 'app',
        clientName: null,
      },
    ]),
}));
vi.mock('../hooks/mutations', () => ({
  useDeployAutomation: () => ({ mutateAsync: vi.fn() }),
  useRestoreAutomationVersion: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({}),
}));
vi.mock('@/app/lib/backend/prefetch', () => ({
  ensureAdaptedQueryData: ensure,
}));
vi.mock('../lib/yaml-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/yaml-source')>()),
  downloadYaml: download,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => vi.fn(),
}));
// The member directory's own hook runs; only its read is answered here.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) =>
    name === 'members/queries:listByOrganization'
      ? reads.members
      : answered(undefined, vi.fn()),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const onViewChange = vi.fn();

function renderTab(view: 'versions' | 'deployments' = 'versions') {
  return render(
    <AutomationVersionsTab
      organizationId="org-1"
      automationSlug="ops/digest"
      view={view}
      onViewChange={onViewChange}
    />,
  );
}

beforeEach(() => {
  ensure.mockReset();
  download.mockReset();
  onViewChange.mockReset();
  refetch.automation.mockReset();
  refetch.members.mockReset();
  reads.automation = answered(
    { name: 'ops/digest', version: 3, latestVersion: 3, deployedVersion: 2 },
    refetch.automation,
  );
  reads.members = answered(
    [{ userId: 'user-ada', displayName: 'Ada Lovelace', email: 'ada@x.test' }],
    refetch.members,
  );
});

describe('AutomationVersionsTab', () => {
  it('shows what is live above the versions, and switches to the deployments', async () => {
    const { user } = renderTab();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Versions' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'v2 is live' })).toBeVisible();
    expect(
      screen.getByRole('table', { name: 'Versions of this automation' }),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Deployments' }));
    expect(onViewChange).toHaveBeenCalledWith('deployments');
  });

  it('lists when each version went live on the Deployments view', () => {
    renderTab('deployments');
    expect(
      screen.getByRole('table', { name: 'When each version went live' }),
    ).toBeVisible();
    expect(screen.getByRole('row', { name: /Deployed v2/ })).toBeVisible();
  });

  it('downloads a version as the YAML the Source view shows', async () => {
    ensure.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 1,
      document: { version: 1, name: 'ops/digest', nodes: [] },
    });
    const { user } = renderTab();
    await user.click(screen.getByRole('button', { name: 'Actions for v1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download YAML' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalledWith(
      {},
      'automations/queries:getAutomation',
      { organizationId: 'org-1', name: 'ops/digest', version: 1 },
    );
    expect(download.mock.calls[0]?.[0]).toContain('name: ops/digest');
    expect(download.mock.calls[0]?.[1]).toBe('ops__digest-v1.yml');
  });

  it('opens the restore of an older version on top of the latest', async () => {
    const { user } = renderTab();
    await user.click(screen.getByRole('button', { name: 'Actions for v1' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Restore as new version' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Restore v1 as a new version?' }),
    ).toBeVisible();
    expect(
      screen.getByText(/Tale saves a copy of v1 as v4\. v2 to v3 stay/),
    ).toBeVisible();
  });

  it('names who saved each version from the member directory', () => {
    renderTab();
    expect(
      within(screen.getByRole('row', { name: /^v1/ })).getByText(
        'Ada Lovelace',
      ),
    ).toBeVisible();
  });

  it('offers no restore while the automation read has failed, and says so with Try again', async () => {
    reads.automation = failed(refetch.automation);
    const { user } = renderTab();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the automation",
    );
    // The versions themselves still list, with what else they offer.
    await user.click(screen.getByRole('button', { name: 'Actions for v1' }));
    expect(
      screen.getByRole('menuitem', { name: 'Download YAML' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: 'Restore as new version' }),
    ).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch.automation).toHaveBeenCalledOnce();
  });

  it('names an author as Someone, never a placeholder that waits forever, while the member directory read has failed', async () => {
    reads.members = failed(refetch.members);
    const { container, user } = renderTab();
    const saved = within(screen.getByRole('row', { name: /^v1/ }));
    expect(saved.getByText('Someone')).toBeVisible();
    expect(saved.getByText('in the app')).toBeVisible();
    expect(container.querySelector('[data-slot="author-pending"]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load member names",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch.members).toHaveBeenCalledOnce();
  });
});
