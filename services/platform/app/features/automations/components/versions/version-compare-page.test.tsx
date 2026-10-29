// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { VersionComparePage } from './version-compare-page';

type Detail = Record<string, unknown> | null;

const store = vi.hoisted(() => ({
  versions: {} as Record<number, Detail>,
  latest: { version: 4, latestVersion: 4, deployedVersion: 2 } as Detail,
  /** Versions whose read fails with a fault after its retries. */
  failing: new Set<number>(),
  /** The automation's own read fails the same way. */
  latestFails: false,
  /** The member directory's read fails the same way. */
  membersFail: false,
}));
const navigate = vi.hoisted(() => vi.fn());
const deploy = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const retryMembers = vi.hoisted(() => vi.fn());

function detail(
  version: number,
  nodes: string[],
  over: Record<string, unknown> = {},
) {
  return {
    name: 'ops/digest',
    version,
    message: `Change ${version}`,
    createdBy: 'user-me',
    createdAt: 1_791_000_000_000 + version,
    createdVia: 'app',
    viaInferred: false,
    clientName: null,
    basedOnVersion: version > 1 ? version - 1 : null,
    restoredFromVersion: null,
    document: {
      version: 1,
      name: 'ops/digest',
      nodes: nodes.map((id) => ({
        id,
        type: 'transform',
        code: `return '${id}';`,
      })),
      output: `{{ nodes.${nodes.at(-1) ?? 'a'}.output }}`,
    },
    ...over,
  };
}

const read = (data: Detail | undefined) => ({
  data,
  isPending: data === undefined,
  isError: data === null,
  error:
    data === null ? { data: { code: 'AUTOMATION_VERSION_UNKNOWN' } } : null,
  refetch: vi.fn(),
});

/** A read that never answered: a 500 the retry policy gave up on, which
 * carries no code, so it is no "missing". */
const failed = () => ({
  data: undefined,
  isPending: false,
  isError: true,
  error: new BackendApiError(500, 'Internal Server Error'),
  isFetching: false,
  errorUpdateCount: 1,
  refetch,
});

vi.mock('../../hooks/queries', () => ({
  useAutomation: () => (store.latestFails ? failed() : read(store.latest)),
  useAutomationAtVersion: (_org: string, _name: string, version?: number) =>
    version === undefined
      ? {
          data: undefined,
          isPending: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }
      : store.failing.has(version)
        ? failed()
        : read(version in store.versions ? store.versions[version] : null),
  useAutomationVersions: () => ({
    data: Object.keys(store.versions).map((version) => ({
      version: Number(version),
    })),
  }),
  useNodeTypeCatalog: () => ({ data: undefined }),
}));
vi.mock('../../hooks/use-deploy-version', () => ({
  useDeployVersion: () => ({
    deploy,
    pendingVersion: null,
    refusal: null,
    closeRefusal: vi.fn(),
  }),
}));
vi.mock('../../hooks/use-download-version', () => ({
  useDownloadVersion: () => vi.fn(),
}));
// The canvas lays out in a real browser; here it says what it was handed.
vi.mock('./version-graph', () => ({
  VersionGraph: ({
    before,
    onSelect,
  }: {
    before: unknown;
    onSelect: (id: string | null) => void;
  }) => (
    <div data-testid="graph" data-first={before === null}>
      <button type="button" onClick={() => onSelect('collect')}>
        pick Collect
      </button>
    </div>
  ),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
vi.mock('@tale/ui/use-media-query', () => ({ useMediaQuery: () => false }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => navigate,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () =>
    store.membersFail
      ? {
          members: undefined,
          unavailable: true,
          retrying: false,
          failureCount: 1,
          retry: retryMembers,
        }
      : { members: [] },
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const onSearchChange = vi.fn();

function renderPage(
  version: number | null,
  search: Parameters<typeof VersionComparePage>[0]['search'] = {},
) {
  return render(
    <VersionComparePage
      organizationId="org-1"
      automationSlug="ops/digest"
      version={version}
      search={search}
      onSearchChange={onSearchChange}
    />,
  );
}

beforeEach(() => {
  store.versions = {
    1: detail(1, ['collect']),
    2: detail(2, ['collect', 'summarize']),
    3: detail(3, ['collect', 'summarize', 'post']),
    4: detail(4, ['collect', 'summarize', 'post'], { message: '' }),
  };
  store.latest = { version: 4, latestVersion: 4, deployedVersion: 2 };
  store.failing = new Set();
  store.latestFails = false;
  store.membersFail = false;
  onSearchChange.mockReset();
  deploy.mockReset();
  refetch.mockReset();
  retryMembers.mockReset();
});

describe('VersionComparePage', () => {
  it('names the version, who saved it, and compares it with the one before', () => {
    renderPage(3);
    expect(
      screen.getByRole('heading', { level: 2, name: 'v3 · Change 3' }),
    ).toBeVisible();
    expect(screen.getByText('You')).toBeVisible();
    expect(
      screen.getByRole('combobox', { name: 'Compare with' }),
    ).toHaveTextContent('v2 · the version before');
    expect(
      within(screen.getByRole('list', { name: 'What changed' })).getByText(
        /1 added/,
      ),
    ).toBeVisible();
    expect(screen.getByTestId('graph')).toHaveAttribute('data-first', 'false');
  });

  it('deploys a newer version, or rolls back to an older one, against the live one', async () => {
    const { user } = renderPage(3);
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    expect(deploy).toHaveBeenCalledWith(3, 2);
    store.latest = { version: 4, latestVersion: 4, deployedVersion: 4 };
    const second = renderPage(3);
    expect(
      within(second.container).getByRole('button', { name: 'Roll back to v3' }),
    ).toBeVisible();
  });

  it('switches between the graph, the changes and the YAML', async () => {
    const { user } = renderPage(3);
    await user.click(screen.getByRole('radio', { name: 'Changes' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ view: 'changes' });
    onSearchChange.mockReset();
    renderPage(3, { view: 'changes' });
    expect(
      screen.getAllByRole('region', { name: /^Nodes/ }).at(-1),
    ).toHaveTextContent('Post');
  });

  it('opens what changed in a node picked on the graph', async () => {
    const { user, unmount } = renderPage(2);
    await user.click(screen.getByRole('button', { name: 'pick Collect' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
      view: 'graph',
      node: 'collect',
    });
    unmount();
    renderPage(2, { node: 'summarize' });
    const panel = screen.getByRole('complementary', {
      name: 'Changes of the node',
    });
    // The panel settles on one entry for the node: while it loads under a
    // busy machine its content can be drawn twice for a moment.
    await waitFor(
      () => expect(within(panel).getByText('Summarize')).toBeVisible(),
      // The suite runs beside other heavy ones: the settling can take longer
      // than the default second.
      { timeout: 10_000 },
    );
    renderPage(2, { node: 'collect' });
    expect(
      screen.getAllByText('This node did not change.').at(-1),
    ).toBeVisible();
  });

  it('says when two versions do not differ, and when only the message does', () => {
    renderPage(4);
    expect(
      screen.getByRole('heading', {
        name: 'No differences between v3 and v4',
      }),
    ).toBeVisible();
    expect(screen.getByText('Only the message is different.')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'v4 · No message',
    );
  });

  it('says the first version is compared with nothing', () => {
    renderPage(1);
    expect(
      screen.getByText('v1 is the first version; everything in it is new.'),
    ).toBeVisible();
    expect(screen.getByTestId('graph')).toHaveAttribute('data-first', 'true');
  });

  it('is a dead end with a way back for a version that is not there', () => {
    renderPage(9);
    expect(
      screen.getByRole('heading', {
        name: 'There is no v9 of this automation.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to the versions' }),
    ).toBeVisible();
    renderPage(null);
    expect(
      screen.getByRole('heading', {
        name: 'There is no v? of this automation.',
      }),
    ).toBeVisible();
  });

  it('says a version below the latest that is gone was removed by retention, one above it never was', () => {
    // v2 is gone and v4 is the latest: version numbers are never reused, so
    // the retention policy removed it.
    delete store.versions[2];
    renderPage(2);
    expect(
      screen.getByRole('heading', {
        name: 'v2 was removed by the retention policy.',
      }),
    ).toBeVisible();
    expect(screen.queryByText(/There is no v2/)).not.toBeInTheDocument();
  });

  it('says the version it was asked to compare with was removed, in the page that still shows the version', () => {
    delete store.versions[2];
    renderPage(3, { from: 2 });
    expect(
      screen.getByText('v2 was removed by the retention policy.'),
    ).toBeVisible();
    // Compared with nothing, every node would count as added.
    expect(screen.queryByRole('list', { name: 'What changed' })).toBeNull();
  });

  it('says the version before could not be loaded, with Try again, and shows no diff against nothing', async () => {
    // v2 is there, but its read fails with a fault after its retries.
    store.failing = new Set([2]);
    const { user } = renderPage(3);
    expect(
      screen.getByRole('heading', { level: 2, name: 'v3 · Change 3' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load v2 to compare with",
    );
    expect(screen.queryByRole('list', { name: 'What changed' })).toBeNull();
    expect(screen.queryByText(/added/)).toBeNull();
    expect(screen.queryByTestId('graph')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows no diff on Changes or YAML either while the version before could not be loaded', () => {
    store.failing = new Set([2]);
    const { unmount } = renderPage(3, { view: 'changes' });
    expect(screen.queryAllByRole('region', { name: /^Nodes/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    unmount();
    renderPage(3, { view: 'yaml' });
    expect(screen.queryByText(/collect/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('offers no deploy or restore while the automation read has failed, and says so with Try again', async () => {
    store.latestFails = true;
    const { user } = renderPage(2);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the automation",
    );
    expect(screen.queryByRole('button', { name: 'Deploy v2' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'More actions for v2' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Download YAML' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: 'Restore as new version' }),
    ).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('names who saved the version as Someone, and says why with Try again, while the member directory read has failed', async () => {
    store.membersFail = true;
    store.versions[3] = detail(3, ['collect', 'summarize', 'post'], {
      createdBy: 'user-ada',
    });
    const { container, user } = renderPage(3);
    expect(screen.getByText('Someone')).toBeVisible();
    expect(container.querySelector('[data-slot="author-pending"]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load member names",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryMembers).toHaveBeenCalledOnce();
  });

  it('says nothing about member names when the version needs none of them', () => {
    store.membersFail = true;
    renderPage(3);
    expect(screen.getByText('You')).toBeVisible();
    expect(screen.queryByText("Couldn't load member names")).toBeNull();
  });

  it('opens against the nearest older version left when the one just before was removed', () => {
    delete store.versions[3];
    renderPage(4);
    expect(
      screen.queryByText('v3 was removed by the retention policy.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Compare with' }),
    ).toHaveTextContent('v2');
  });

  it('passes an axe audit', async () => {
    const { container } = renderPage(3, { view: 'changes' });
    await checkAccessibility(container);
  });
});
