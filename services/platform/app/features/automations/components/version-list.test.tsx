import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, fireEvent } from '@/tests/utils/render';

import { VersionList } from './version-list';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', async () => ({
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => navigate,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'a', displayName: 'Ada Lovelace' }],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const versions = [
  {
    version: 1,
    message: 'first cut',
    testsPassed: true,
    createdBy: 'user:a',
    createdAt: 1_700_000_000_000,
  },
  {
    version: 2,
    message: 'add the digest step',
    testsPassed: false,
    createdBy: 'api-key:a',
    createdAt: 1_700_000_100_000,
    createdVia: 'mcp' as const,
    clientName: 'Claude Code',
    basedOnVersion: 1,
    restoredFromVersion: 1,
  },
];

function renderList({
  deployedVersion = 1,
  projectId,
}: { deployedVersion?: number | undefined; projectId?: string } = {}) {
  return render(
    <>
      <h2 id="versions-heading">Versions</h2>
      <VersionList
        organizationId="org-1"
        automationSlug="billing/dunning"
        {...(projectId !== undefined && { projectId })}
        versions={versions}
        currentVersion={2}
        deployedVersion={deployedVersion}
        headingId="versions-heading"
      />
    </>,
  );
}

describe('VersionList', () => {
  it('says who saved each version and how, what it restores, and links the whole history', () => {
    renderList();
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);
    expect(screen.getByText('with Claude Code through MCP')).toBeVisible();
    expect(screen.getByText('Restores v1')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'All versions and changes' }),
    ).toBeVisible();
  });

  it('marks the version that is live and does not offer deploy on the row', () => {
    renderList();
    expect(screen.getByRole('img', { name: 'Live' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Deploy/ }),
    ).not.toBeInTheDocument();
  });

  it('says which versions were saved with failing tests', () => {
    renderList();
    expect(screen.getByRole('img', { name: 'Tests failed' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Tests passed' })).toBeVisible();
  });

  it('counts the tests that passed and says which act checked them, and when', () => {
    render(
      <VersionList
        organizationId="org-1"
        automationSlug="billing/dunning"
        versions={[
          {
            version: 3,
            message: 'raise the threshold',
            testsPassed: false,
            testsCheckedAt: Date.UTC(2023, 10, 14, 12, 0),
            tests: { passed: 2, failed: 1, total: 3, via: 'deploy' },
            createdBy: 'user:a',
            createdAt: 1_700_000_150_000,
          },
        ]}
        currentVersion={3}
        deployedVersion={undefined}
        headingId="versions-heading"
      />,
    );
    expect(
      screen.getByRole('img', {
        name: /^2 of 3 tests passed · checked on deploy · November 14, 2023/,
      }),
    ).toBeVisible();
  });

  it('shows the version messages so the history reads', () => {
    renderList();
    expect(screen.getByText('add the digest step')).toBeVisible();
    expect(screen.getByText('first cut')).toBeVisible();
  });

  it('selects the current version and orders newest first', () => {
    renderList();
    const rows = screen.getAllByRole('radio');
    expect(rows[0]).toBeChecked();
    expect(rows[1]).not.toBeChecked();
    fireEvent.click(rows[1]);
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params: { id: 'org-1', automationSlug: 'billing__dunning' },
      search: { version: 1 },
    });
  });

  it('opens the current version from another tab when it is already checked', () => {
    renderList();
    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params: { id: 'org-1', automationSlug: 'billing__dunning' },
      search: { version: 2 },
    });
  });

  it('keeps version selection inside the project shell', () => {
    renderList({ projectId: 'proj-1' });
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params: {
        id: 'org-1',
        projectId: 'proj-1',
        automationSlug: 'billing__dunning',
      },
      search: { version: 1 },
    });
  });

  it('names the list by the tab heading', () => {
    renderList();
    expect(screen.getByRole('radiogroup', { name: 'Versions' })).toBeVisible();
  });

  it('says so when nothing has been saved yet', () => {
    render(
      <VersionList
        organizationId="org-1"
        automationSlug="billing/dunning"
        versions={[]}
        deployedVersion={undefined}
        headingId="versions-heading"
      />,
    );
    expect(screen.getByText('No versions saved yet.')).toBeVisible();
  });

  it('passes an axe audit', async () => {
    const { container } = renderList();
    await checkAccessibility(container);
  });
});
