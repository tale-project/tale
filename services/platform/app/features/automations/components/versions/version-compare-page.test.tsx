// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { VersionComparePage } from './version-compare-page';

type Detail = Record<string, unknown> | null;

const store = vi.hoisted(() => ({
  versions: {} as Record<number, Detail>,
  latest: { version: 4, latestVersion: 4, deployedVersion: 2 } as Detail,
}));
const navigate = vi.hoisted(() => vi.fn());
const deploy = vi.hoisted(() => vi.fn());

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

vi.mock('../../hooks/queries', () => ({
  useAutomation: () => read(store.latest),
  useAutomationAtVersion: (_org: string, _name: string, version?: number) =>
    version === undefined
      ? {
          data: undefined,
          isPending: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }
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
  useMembers: () => ({ members: [] }),
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
  onSearchChange.mockReset();
  deploy.mockReset();
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
    await waitFor(() =>
      expect(within(panel).getByText('Summarize')).toBeVisible(),
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

  it('passes an axe audit', async () => {
    const { container } = renderPage(3, { view: 'changes' });
    await checkAccessibility(container);
  });
});
