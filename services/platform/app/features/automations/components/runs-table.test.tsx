import { describe, expect, it, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { RunsTable } from './runs-table';

const page = vi.hoisted(() => ({
  results: [] as Array<Record<string, unknown>>,
  status: 'Exhausted' as string,
  calls: [] as unknown[],
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useAutomationRunsPage: (args: unknown) => {
    page.calls.push(args);
    return {
      results: page.results,
      status: page.status,
      isLoading: false,
      loadMore: vi.fn(),
      error: null,
      retry: vi.fn(),
      isRetrying: false,
      unavailable: false,
      errorCount: 0,
    };
  },
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => navigate,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      { userId: 'user-me', displayName: 'Zoe A.', email: 'zoe@example.test' },
      {
        userId: 'user-dana',
        displayName: 'Dana K.',
        email: 'dana@example.test',
      },
    ],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

function run(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'triage',
    version: 2,
    status: 'success',
    mode: 'mock',
    startedBy: 'user:user-me',
    startedAt: 1_789_363_168_936,
    finishedAt: 1_789_363_170_729,
    ...over,
  };
}

beforeEach(() => {
  page.results = [];
  page.status = 'Exhausted';
  page.calls = [];
  navigate.mockReset();
});

function renderTable() {
  return render(<RunsTable organizationId="org-1" automationSlug="triage" />);
}

describe('RunsTable', () => {
  it('says how each run ended, why a failed one failed and who started it', () => {
    page.results = [
      run('r-ok'),
      run('r-failed', {
        status: 'failed',
        failureCode: 'connector_error',
        detail: 'send: no usable credential for imap-smtp',
        startedBy: 'user:user-dana',
      }),
      run('r-old', {
        status: 'failed',
        detail: 'send: the engine said so',
      }),
      run('r-wait', {
        status: 'waiting',
        waitingFor: 'repeat',
        detail: 'repeat:tick',
        startedBy: 'trigger:t-1',
        startedVia: 'schedule',
      }),
    ];
    renderTable();
    const table = screen.getByRole('table', {
      name: 'Runs of this automation',
    });
    expect(within(table).getByText('A service call failed')).toBeVisible();
    // An older failure without a code keeps the engine's sentence.
    expect(within(table).getByText('send: the engine said so')).toBeVisible();
    expect(within(table).getByText('Polling — step tick')).toBeVisible();
    expect(within(table).getAllByText('Started by you')).toHaveLength(2);
    expect(within(table).getByText('Started by Dana K.')).toBeVisible();
    expect(within(table).getByText('Started by the schedule')).toBeVisible();
    expect(within(table).queryByText(/repeat:|user:|trigger:/)).toBeNull();
    expect(page.calls.at(-1)).toEqual({
      organizationId: 'org-1',
      name: 'triage',
      statuses: [],
    });
  });

  it('says what a waiting run is parked on, never the raw park', () => {
    page.results = [
      run('r-a', {
        status: 'waiting',
        waitingFor: 'approval',
        detail: 'approval:0ae97156-e148-4250-9a6f-dfe95893e9ac',
      }),
      run('r-g', {
        status: 'waiting',
        waitingFor: 'agent',
        detail: 'agent:review',
      }),
      run('r-q', {
        status: 'waiting',
        waitingFor: 'ask',
        detail: 'agent:review',
      }),
      run('r-d', {
        status: 'waiting',
        waitingFor: 'in_doubt',
        detail: 'in_doubt:send_invoice',
      }),
      run('r-stop', { status: 'cancelled', detail: 'repeat:tick' }),
      run('r-stalled', { status: 'running', stalled: true }),
    ];
    renderTable();
    const table = screen.getByRole('table', {
      name: 'Runs of this automation',
    });
    expect(within(table).getByText('Waiting for approval')).toBeVisible();
    expect(within(table).getByText('Agent working')).toBeVisible();
    expect(within(table).getByText('Waiting for your answer')).toBeVisible();
    expect(within(table).getByText('Interrupted — resuming')).toBeVisible();
    expect(
      within(table).getByText(
        'Waiting for a decision — step send_invoice may already have run',
      ),
    ).toBeVisible();
    expect(
      within(table).queryByText(/approval:|agent:|in_doubt:|repeat:/),
    ).toBeNull();
  });

  it('opens the comparison of two selected runs', async () => {
    page.results = [run('run-a'), run('run-b'), run('run-c')];
    const { user } = renderTable();
    const box = (index: number) =>
      screen.getAllByRole('checkbox', { name: 'Select row' })[
        index
      ] as HTMLElement;
    await user.click(box(0));
    const compare = screen.getByRole('button', { name: 'Compare' });
    expect(compare).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('1 run selected')).toBeVisible();
    await user.click(box(1));
    expect(screen.getByText('2 runs selected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/triage/runs/compare',
      search: { a: 'run-a', b: 'run-b' },
    });
  });

  it('opens a run from its row', async () => {
    page.results = [run('run-a')];
    const { user } = renderTable();
    await user.click(screen.getByText('Started by you'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/triage/runs/run-a',
    });
  });

  it('says when the automation has not run', () => {
    renderTable();
    expect(screen.getByText('This automation has not run yet.')).toBeVisible();
  });

  it('passes an axe audit', async () => {
    page.results = [
      run('run-a'),
      run('run-b', { status: 'failed', failureCode: 'node_error' }),
    ];
    const { container } = renderTable();
    await checkAccessibility(container);
  });
});
