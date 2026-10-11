// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { LiveVersionCard } from './live-version-card';

const live = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  isError: false,
}));

vi.mock('../../hooks/queries', () => ({
  useAutomationLiveDeployment: () => ({
    ...live,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'user-noah', displayName: 'Noah Weber' }],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const deploy = vi.fn();

function liveVersion(over: Record<string, unknown> = {}) {
  return {
    live: {
      version: 5,
      deployedAt: 1_791_300_000_000,
      deployedBy: 'api-key:user-noah',
      via: 'mcp',
      clientName: 'Claude Code',
      activeRuns: 2,
    },
    deployments: [
      {
        id: 'e-5',
        version: 5,
        previousVersion: 4,
        kind: 'deploy',
        synthesized: false,
        deployedAt: 1_791_300_000_000,
        deployedBy: 'api-key:user-noah',
        via: 'mcp',
        clientName: 'Claude Code',
      },
    ],
    nextBefore: null,
    ...over,
  };
}

function renderCard(
  props: Partial<Parameters<typeof LiveVersionCard>[0]> = {},
) {
  return render(
    <LiveVersionCard
      organizationId="org-1"
      automationSlug="ops/digest"
      canAuthor
      latestVersion={6}
      deployer={{ deploy, pendingVersion: null }}
      {...props}
    />,
  );
}

beforeEach(() => {
  live.data = liveVersion();
  live.isPending = false;
  live.isError = false;
  deploy.mockReset();
});

describe('LiveVersionCard', () => {
  it('says what is live, since when, by whom and how many of its runs are still going', async () => {
    const { container } = renderCard();
    expect(screen.getByRole('heading', { name: 'v5 is live' })).toBeVisible();
    expect(screen.getByText(/^Since /)).toBeVisible();
    expect(screen.getByText('Noah Weber')).toBeVisible();
    expect(screen.getByText('with Claude Code through MCP')).toBeVisible();
    expect(
      screen.getByText('2 runs of v5 are in progress; they finish on v5.'),
    ).toBeVisible();
    await checkAccessibility(container);
  });

  it('rolls back to the version the live one replaced, naming the live one', async () => {
    const { user } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Roll back to v4' }));
    expect(deploy).toHaveBeenCalledWith(4, 5);
  });

  it('puts the replaced version live again after a rollback, in its own words', () => {
    live.data = liveVersion({
      live: { ...liveVersion().live, version: 3 },
      deployments: [
        { ...liveVersion().deployments[0], version: 3, previousVersion: 5 },
      ],
    });
    renderCard();
    expect(screen.getByRole('button', { name: 'Deploy v5' })).toBeVisible();
  });

  it('offers no rollback without a replaced version, nor to a reader who cannot deploy', () => {
    live.data = liveVersion({
      deployments: [{ ...liveVersion().deployments[0], previousVersion: null }],
    });
    const { unmount } = renderCard();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    live.data = liveVersion();
    renderCard({ canAuthor: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says nothing is live yet and offers the latest version', async () => {
    live.data = { live: null, deployments: [], nextBefore: null };
    const { user } = renderCard();
    expect(
      screen.getByText(
        'No version is live yet. Triggers and live runs start only after you deploy one.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Deploy v6' }));
    expect(deploy).toHaveBeenCalledWith(6, null);
  });

  it('keeps the button and its focus while the deploy runs, without a second one', async () => {
    const { user } = renderCard({
      deployer: { deploy, pendingVersion: 4 },
    });
    const button = screen.getByRole('button', { name: 'Roll back to v4' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(deploy).not.toHaveBeenCalled();
  });
});
