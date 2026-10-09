import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxCapacity } from '@/app/lib/backend/contract/sandbox';
import { i18n } from '@/lib/i18n/i18n';
import type { SandboxDeviceView } from '@/lib/shared/schemas/sandbox-devices';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { SandboxesSettings } from './sandboxes-settings';

const { state, query, mutate, refreshCapacity, refreshLimits, toast } =
  vi.hoisted(() => ({
    state: { canRead: true, canManage: false, abilityLoading: false },
    query: vi.fn(),
    mutate: vi.fn(),
    refreshCapacity: vi.fn(),
    refreshLimits: vi.fn(),
    toast: vi.fn(),
  }));

/** One project-agent op as the view lists it: with its task's key and
 * title, unless the task is gone since. */
function taskOp(
  execId: string,
  taskId: string,
  startedAt: number,
  task?: { key?: string; title: string },
) {
  return {
    kind: 'task-agent' as const,
    execId,
    taskId,
    ...(task !== undefined
      ? { task: { id: taskId, projectId: 'project-1', ...task } }
      : {}),
    status: 'running',
    startedAt,
  };
}

/** The list read's answer: the workspaces, and the agent runs waiting for
 * room by reason. */
function view(sessions: unknown[], waitingForWorkers = 0) {
  return {
    sessions,
    waitingRuns: {
      total: waitingForWorkers,
      byReason: {
        org_limit: waitingForWorkers,
        host: 0,
        destroy_pending: 0,
        exec_limit: 0,
        unknown: 0,
      },
    },
  };
}

/** Alice's first worker, with three turns executing in it at once: its
 * task's turn, a steered turn's predecessor still in its kill grace, and a
 * turn whose task is gone since. */
const aliceRow = {
  sessionId: 'session-alice',
  ownerType: 'project_agent',
  ownerId: 'agent-alice',
  ownerLabel: 'Alice',
  worker: { number: 1, scope: 'agent' as const },
  createdBy: 'system:task-agent',
  ownerName: null,
  ownerEmail: null,
  agentKind: 'claude-code',
  status: 'active',
  createdAt: 1_750_000_000_000,
  expiresAt: 1_750_003_600_000,
  lastActivityAt: null,
  pinned: false,
  busy: true,
  totalSpentCents: 12.5,
  currentOp: taskOp('exec-3', '3be051fb-0000-4000-8000-000000000003', 3, {
    key: 'WEB-12',
    title: 'Release notes',
  }),
  runningOps: [
    taskOp('exec-1', 'd01a4b15-0000-4000-8000-000000000001', 1),
    taskOp('exec-2', '3be051fb-0000-4000-8000-000000000003', 2, {
      key: 'WEB-12',
      title: 'Release notes',
    }),
    taskOp('exec-3', '3be051fb-0000-4000-8000-000000000003', 3, {
      key: 'WEB-12',
      title: 'Release notes',
    }),
  ],
};

/** A project agent's workspace that outlived its agent: the owner join
 * answers nothing, so the label is null and only the id remains. */
const orphanRow = {
  ...aliceRow,
  sessionId: 'session-orphan',
  ownerId: '2408c68d-4585-4dc4-9123-a6d9f31af5b9',
  ownerLabel: null,
  busy: false,
  totalSpentCents: 0,
  currentOp: null,
  runningOps: [],
};

/** Bob's workspace, hibernated and unused: the cleanup will delete it on
 * `deletesAt` unless the agent works in it again first. */
const hibernatedRow = {
  ...aliceRow,
  sessionId: 'session-bob',
  ownerId: 'agent-bob',
  ownerLabel: 'Bob',
  status: 'stopped',
  busy: false,
  totalSpentCents: 0,
  currentOp: null,
  runningOps: [],
  // Noon UTC, so the day reads the same in every runner's time zone.
  deletesAt: Date.UTC(2026, 9, 31, 12),
};

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params: Record<string, string>;
  }) => (
    <a
      href={Object.entries(params).reduce(
        (href, [key, value]) => href.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string) =>
      action === 'write' ? state.canManage : state.canRead,
    cannot: (action: string) =>
      action === 'write' ? !state.canManage : !state.canRead,
  }),
  useAbilityLoading: () => state.abilityLoading,
}));
vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery: query }));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutate, mutateAsync: mutate }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: mutate, isPending: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('../governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: mutate }),
}));

beforeEach(() => {
  state.canRead = true;
  state.canManage = false;
  state.abilityLoading = false;
  toast.mockReset();
  mutate.mockReset();
  refreshCapacity.mockReset();
  refreshLimits.mockReset();
  query.mockReset().mockImplementation((name: string) => ({
    // Deliberately return cached private rows even for skipped requests. A
    // permission downgrade must remove already-fetched metadata from the UI.
    data: name.endsWith(':listSandboxesForOrg')
      ? view([
          {
            sessionId: 'session-private',
            ownerId: 'agent-private',
            ownerLabel: 'Restricted project',
            createdBy: 'system:task-agent',
            agentKind: null,
            status: 'active',
            createdAt: 1_750_000_000_000,
            pinned: false,
            busy: false,
            totalSpentCents: 0,
            currentOp: null,
            runningOps: [],
          },
          aliceRow,
          orphanRow,
          hibernatedRow,
        ])
      : name === 'governance/queries:getPolicy'
        ? null
        : name.endsWith(':getSandboxQuotaUsage')
          ? [
              { budget: 'project', used: 1, cap: 2 },
              { budget: 'workflow', used: 0, cap: 2 },
              { budget: 'render', used: 0, cap: 2 },
            ]
          : name.endsWith(':getSandboxDeploymentLimits')
            ? { status: 'available', maxSessions: 16 }
            : name === 'sandbox_devices/queries:list'
              ? { devices: [], hub: 'available', serverVersion: '0.5.60' }
              : { status: 'unavailable', reason: 'unreachable' },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: name.endsWith(':getSandboxCapacity')
      ? refreshCapacity
      : name.endsWith(':getSandboxDeploymentLimits')
        ? refreshLimits
        : vi.fn(),
  }));
});

function renderSettings() {
  return render(
    <ActiveEditorProvider>
      <EditorGroup>
        <SandboxesSettings organizationId="org-1" />
      </EditorGroup>
    </ActiveEditorProvider>,
  );
}

describe.each(SHIPPED_LOCALES)(
  'SandboxesSettings placement observations (%s)',
  (locale) => {
    const device: SandboxDeviceView = {
      id: 'device-other',
      name: 'Other administrator laptop',
      status: 'online',
      createdAt: 1_790_000_000_000,
      createdBy: 'admin-other',
      lastSeenAt: 1_790_000_060_000,
      connectedAt: 1_790_000_000_000,
      version: '0.5.60',
      maxSessions: 4,
      platform: null,
      sessions: { running: 1, starting: 0 },
      resources: null,
      update: null,
    };
    const available: Extract<SandboxCapacity, { status: 'available' }> = {
      status: 'available',
      observedAt: 1_790_000_060_000,
      backend: 'docker',
      scope: 'host',
      sessions: {
        running: 1,
        starting: 0,
        limit: 16,
        organizationRunning: 1,
        organizationStarting: 0,
        organizationLimit: 16,
      },
      resources: {
        cpu: { totalCores: 8, usedCores: 1 },
        memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 1024 ** 3 },
      },
      runtimeSessions: [{ sessionId: aliceRow.sessionId, state: 'running' }],
      placements: [{ sessionId: aliceRow.sessionId, deviceId: device.id }],
    };
    let observation: {
      data: SandboxCapacity | undefined;
      isError?: boolean;
      isLoading?: boolean;
    };

    beforeEach(() => {
      state.canManage = true;
      saveLocale(locale);
      observation = { data: available };
      const reads = query.getMockImplementation();
      query.mockImplementation((name: string) => {
        const answer = reads?.(name);
        if (name.endsWith(':getSandboxCapacity'))
          return { ...answer, ...observation };
        if (name === 'sandbox_devices/queries:list') {
          return {
            ...answer,
            data: {
              devices: [device],
              hub: 'available',
              serverVersion: '0.5.60',
            },
          };
        }
        return name.endsWith(':listSandboxesForOrg')
          ? { ...answer, data: view([aliceRow]) }
          : answer;
      });
    });
    afterEach(forgetSavedLocale);

    function settingsView() {
      return (
        <ActiveEditorProvider>
          <EditorGroup>
            <SandboxesSettings organizationId="org-1" />
          </EditorGroup>
        </ActiveEditorProvider>
      );
    }

    it.each([
      {
        data: {
          status: 'unavailable',
          reason: 'unreachable',
        } satisfies SandboxCapacity,
      },
      {
        data: {
          status: 'unavailable',
          reason: 'not_configured',
        } satisfies SandboxCapacity,
      },
      { data: undefined, isLoading: true },
      { data: available, isError: true },
    ])(
      'does not assert server placement after a failed observation: %j',
      async (failed) => {
        const { rerender } = render(settingsView());
        await waitFor(() => expect(i18n.language).toBe(locale));
        const translate = i18n.getFixedT(locale, 'sandboxes');
        const row = screen.getByText('Alice').closest('tr') as HTMLElement;
        const deviceLabel = translate('runsOn.device', { name: device.name });
        expect(within(row).getByText(deviceLabel)).toBeInTheDocument();

        observation = failed;
        rerender(settingsView());
        expect(screen.getByText('Alice').closest('tr')).toBe(row);
        expect(
          within(row).getByText(translate('status.runtime.unknown')),
        ).toBeInTheDocument();
        expect(
          within(row).queryByText(translate('runsOn.server')),
        ).not.toBeInTheDocument();
        expect(within(row).queryByText(deviceLabel)).not.toBeInTheDocument();

        observation = { data: available };
        rerender(settingsView());
        expect(within(row).getByText(deviceLabel)).toBeInTheDocument();
        expect(
          within(row).getByText(translate('status.runtime.running')),
        ).toBeInTheDocument();
      },
    );

    it.each([
      { placements: [] },
      { placements: [{ sessionId: 'session-other', deviceId: device.id }] },
    ])(
      'keeps a known server workspace running when available placements are %j',
      async ({ placements }) => {
        observation = { data: { ...available, placements } };
        render(settingsView());
        await waitFor(() => expect(i18n.language).toBe(locale));
        const translate = i18n.getFixedT(locale, 'sandboxes');
        const row = screen.getByText('Alice').closest('tr') as HTMLElement;
        expect(
          within(row).getByText(translate('runsOn.server')),
        ).toBeInTheDocument();
        expect(
          within(row).getByText(translate('status.runtime.running')),
        ).toBeInTheDocument();
      },
    );
    it('does not assert a location when a successful capacity snapshot omits placements', async () => {
      observation = { data: { ...available, placements: undefined } };
      render(settingsView());
      await waitFor(() => expect(i18n.language).toBe(locale));
      const translate = i18n.getFixedT(locale, 'sandboxes');
      const row = screen.getByText('Alice').closest('tr') as HTMLElement;
      expect(
        within(row).getByText(translate('status.runtime.running')),
      ).toBeInTheDocument();
      expect(
        within(row).queryByText(translate('runsOn.server')),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByText(
          translate('runsOn.device', { name: device.name }),
        ),
      ).not.toBeInTheDocument();
    });

    it('keeps an initially unavailable workspace unknown and accessible', async () => {
      observation = { data: { status: 'unavailable', reason: 'unreachable' } };
      render(settingsView());
      await waitFor(() => expect(i18n.language).toBe(locale));
      const translate = i18n.getFixedT(locale, 'sandboxes');
      const table = screen.getByRole('table', { name: translate('title') });
      expect(
        within(table).getByText(translate('status.runtime.unknown')),
      ).toBeInTheDocument();
      expect(
        within(table).queryByText(translate('runsOn.server')),
      ).not.toBeInTheDocument();
      expect(
        within(table).queryByText(
          translate('runsOn.device', { name: device.name }),
        ),
      ).not.toBeInTheDocument();
      await checkAccessibility(table);
    });
  },
);

describe('SandboxesSettings access', () => {
  it('refreshes deployment limits alongside runtime observations', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refreshCapacity).toHaveBeenCalledOnce();
    expect(refreshLimits).toHaveBeenCalledOnce();
  });

  it('reports the capacity as still loading, not unavailable, while the role loads', () => {
    // The limits query is skipped until the role is known: not loading and
    // without data — which must not flash the unavailable alert.
    state.abilityLoading = true;
    state.canRead = false;
    renderSettings();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByText('Checking deployment capacity…'),
    ).toBeInTheDocument();
  });

  it('shows developers aggregate capacity and limits without querying or rendering workspace metadata', () => {
    renderSettings();
    expect(query).toHaveBeenCalledWith(
      'sandbox/session_queries_public:listSandboxesForOrg',
      'skip',
    );
    expect(query).toHaveBeenCalledWith(
      'sandbox/session_queries_public:getSandboxCapacity',
      { organizationId: 'org-1' },
    );
    expect(query).toHaveBeenCalledWith(
      'sandbox/session_queries_public:getSandboxDeploymentLimits',
      { organizationId: 'org-1' },
    );
    expect(
      screen.getByRole('status', { name: 'Total organization sessions' }),
    ).toHaveTextContent('6 / 16');
    expect(
      screen.getByRole('heading', { name: 'Organization limits' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Infrastructure capacity' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Workspaces' }),
    ).not.toBeInTheDocument();
    // The cleanup policy is an admin read: developers neither see its
    // editor nor ask for it.
    expect(
      screen.queryByRole('heading', { name: 'Workspace cleanup' }),
    ).not.toBeInTheDocument();
    expect(query).not.toHaveBeenCalledWith(
      'governance/queries:getPolicy',
      expect.anything(),
    );
    expect(screen.queryByText('Restricted project')).not.toBeInTheDocument();
    // Developers see the organization's devices, never the workspace table.
    expect(
      screen.queryByRole('table', { name: 'Sandboxes' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Devices' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add device' }),
    ).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('tells a manager how many agent runs wait for a free worker, under the agent workers limit', () => {
    state.canManage = true;
    const reads = query.getMockImplementation();
    query.mockImplementation((name: string) => {
      const answer = reads?.(name);
      return name.endsWith(':listSandboxesForOrg')
        ? { ...answer, data: view([aliceRow], 2) }
        : answer;
    });
    renderSettings();
    expect(
      screen.getByRole('spinbutton', { name: 'Agent workers' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Each task an agent works on at the same time runs in a sandbox of its own.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('2 agent runs are waiting for a free worker.'),
    ).toBeInTheDocument();
  });

  it('shows the workspaces without a waiting count from an api of the previous release', () => {
    state.canManage = true;
    const reads = query.getMockImplementation();
    query.mockImplementation((name: string) => {
      const answer = reads?.(name);
      return name.endsWith(':listSandboxesForOrg')
        ? { ...answer, data: { sessions: [aliceRow] } }
        : answer;
    });
    renderSettings();
    expect(
      screen.getByRole('spinbutton', { name: 'Agent workers' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Alice').closest('tr')).not.toBeNull();
    expect(screen.queryByText(/waiting for a free worker/)).toBeNull();
  });

  it('keeps the waiting count from a developer, who reads no workspaces', () => {
    const reads = query.getMockImplementation();
    query.mockImplementation((name: string) => {
      const answer = reads?.(name);
      return name.endsWith(':listSandboxesForOrg')
        ? { ...answer, data: view([aliceRow], 2) }
        : answer;
    });
    renderSettings();
    expect(screen.queryByText(/waiting for a free worker/)).toBeNull();
  });

  it('lets organization settings managers query and view workspaces', () => {
    state.canManage = true;
    renderSettings();
    expect(query).toHaveBeenCalledWith(
      'sandbox/session_queries_public:listSandboxesForOrg',
      { organizationId: 'org-1' },
    );
    expect(
      screen.getByRole('heading', { name: 'Workspaces' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Restricted project')).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('gives organization settings managers the workspace cleanup policy, right above the workspaces', () => {
    state.canManage = true;
    renderSettings();
    expect(query).toHaveBeenCalledWith('governance/queries:getPolicy', {
      organizationId: 'org-1',
      policyType: 'sandbox_workspaces',
    });
    expect(
      screen.getByRole('switch', { name: 'Delete unused workspaces' }),
    ).toBeChecked();
    const sections = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(sections.indexOf('Workspaces')).toBe(
      sections.indexOf('Workspace cleanup') + 1,
    );
  });
});

describe('SandboxesSettings workspace rows', () => {
  beforeEach(() => {
    state.canManage = true;
  });

  it('lists every turn running in a worker by its task, not just the latest one', () => {
    renderSettings();
    const row = screen.getByText('Alice').closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText('3 project tasks'),
    ).toBeInTheDocument();
    // A task reads as its key and title and opens on its own page.
    const links = within(row as HTMLElement).getAllByRole('link', {
      name: 'WEB-12 Release notes',
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      'href',
      '/dashboard/org-1/tasks/3be051fb-0000-4000-8000-000000000003',
    );
    // A task gone since keeps its id prefix; no raw id of a known task.
    expect(
      within(row as HTMLElement).getByText('d01a4b15'),
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText('3be051fb')).toBeNull();
    // Lifetime spend of the workspace, in dollars.
    expect(within(row as HTMLElement).getByText('$0.13')).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByText('claude-code'),
    ).toBeInTheDocument();
  });

  it('names the worker each of an agent’s workspaces is, its own or a member’s', () => {
    const reads = query.getMockImplementation();
    query.mockImplementation((name: string) => {
      const answer = reads?.(name);
      return name.endsWith(':listSandboxesForOrg')
        ? {
            ...answer,
            data: view([
              aliceRow,
              {
                ...aliceRow,
                sessionId: 'session-alice-w2',
                worker: { number: 2, scope: 'agent' },
                currentOp: null,
                runningOps: [
                  taskOp('exec-4', 'task-changelog', 4, {
                    key: 'WEB-13',
                    title: 'Changelog',
                  }),
                ],
              },
              {
                ...hibernatedRow,
                worker: { number: 2, scope: 'member' },
              },
            ]),
          }
        : answer;
    });
    renderSettings();
    const [first, second] = screen
      .getAllByText('Alice')
      .map((cell) => cell.closest('tr') as HTMLElement);
    expect(within(first as HTMLElement).getByText('Worker 1')).toBeVisible();
    expect(within(second as HTMLElement).getByText('Worker 2')).toBeVisible();
    expect(
      within(second as HTMLElement).getByRole('link', {
        name: 'WEB-13 Changelog',
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-changelog');
    const bob = screen.getByText('Bob').closest('tr') as HTMLElement;
    expect(within(bob).getByText('Member worker 2')).toBeVisible();
  });

  it('names a workspace whose agent was deleted, never its raw id', () => {
    renderSettings();
    const row = screen.getByText('Deleted agent').closest('tr');
    expect(row).not.toBeNull();
    expect(
      screen.queryByText('2408c68d-4585-4dc4-9123-a6d9f31af5b9'),
    ).not.toBeInTheDocument();
  });

  it('dates the deletion of an unused workspace, and of no other', () => {
    renderSettings();
    const bob = screen.getByText('Bob').closest('tr') as HTMLElement;
    // Dated like the Created column (the short localized date).
    expect(
      within(bob).getByText('Deleted on 10/31/2026 unless used again'),
    ).toBeInTheDocument();
    const alice = screen.getByText('Alice').closest('tr') as HTMLElement;
    expect(within(alice).queryByText(/^Deleted on/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Deleted on/)).toHaveLength(1);
  });

  it('shows an idle workspace without a task and without a spend', () => {
    renderSettings();
    const row = screen.getByText('Restricted project').closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText('No active task'),
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByText('—').length).toBeGreaterThan(
      0,
    );
  });

  it('labels the row-action column for screen readers only', () => {
    renderSettings();
    const headers = within(screen.getByRole('table', { name: 'Sandboxes' }))
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual([
      'Workspace',
      'Agent',
      'Status',
      'Current tasks',
      'Spend',
      'Created',
      'Row actions',
    ]);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });
});

// A Destroy is queued and runs as a job: the page answers at once, says
// which rows are being destroyed, and which Destroy ran out of attempts.
describe('SandboxesSettings Destroy', () => {
  beforeEach(() => {
    state.canManage = true;
  });

  /** Serve these workspace rows; every other read as the default mock. */
  function listing(rows: unknown[]) {
    const reads = query.getMockImplementation();
    query.mockImplementation((name: string) => {
      const answer = reads?.(name);
      return name.endsWith(':listSandboxesForOrg')
        ? { ...answer, data: view(rows) }
        : answer;
    });
  }

  async function openRowMenu(
    user: ReturnType<typeof renderSettings>['user'],
    owner: string,
  ) {
    const row = screen.getByText(owner).closest('tr') as HTMLElement;
    await user.click(
      within(row).getByRole('button', {
        name: i18n.getFixedT('en', 'common')('actions.openMenu'),
      }),
    );
    return row;
  }

  it('reads a queued Destroy on its row and holds Pin and Destroy, not Stop, meanwhile', async () => {
    listing([{ ...aliceRow, destroyState: 'pending' }, hibernatedRow]);
    const { user } = renderSettings();
    const alice = await openRowMenu(user, 'Alice');
    expect(within(alice).getByText('Destroying')).toBeInTheDocument();
    for (const name of ['Pin', 'Destroy']) {
      expect(await screen.findByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    // A task running while the Destroy retries can still be stopped.
    expect(
      await screen.findByRole('menuitem', { name: 'Stop task' }),
    ).not.toHaveAttribute('aria-disabled');
    const bob = screen.getByText('Bob').closest('tr') as HTMLElement;
    expect(within(bob).queryByText('Destroying')).not.toBeInTheDocument();
  });

  it('says a Destroy failed and lets it be asked for again', async () => {
    listing([{ ...hibernatedRow, destroyState: 'failed' }]);
    const { user } = renderSettings();
    const bob = await openRowMenu(user, 'Bob');
    expect(within(bob).getByText('Destroy failed')).toBeInTheDocument();
    expect(
      await screen.findByRole('menuitem', { name: 'Destroy' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('closes the confirmation as soon as the Destroy is queued', async () => {
    mutate.mockResolvedValue(null);
    const { user } = renderSettings();
    await openRowMenu(user, 'Bob');
    await user.click(await screen.findByRole('menuitem', { name: 'Destroy' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Destroy sandbox?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Destroy' }));
    expect(mutate).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 'session-bob',
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Destroying sandbox',
        description: 'It leaves the list once its workspace is deleted.',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Destroy sandbox?' }),
      ).not.toBeInTheDocument(),
    );
  });
});

// An `AppError`'s own `message` is its serialized payload: a refused stop
// used to read `{"code":"UNAUTHORIZED",…}` under "Action failed".
describe.each(SHIPPED_LOCALES)(
  'SandboxesSettings after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      state.canManage = true;
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it.each(['stop', 'pin'] as const)(
      'says the session ended when a %s is refused',
      async (action) => {
        mutate.mockImplementation((args: { sessionId?: string }) =>
          args.sessionId === undefined
            ? Promise.resolve(undefined)
            : lapsedSessionRefusal(),
        );
        const { user } = renderSettings();
        await waitFor(() => expect(i18n.language).toBe(locale));
        const tSandboxes = i18n.getFixedT(locale, 'sandboxes');

        const row = screen.getByText('Alice').closest('tr') as HTMLElement;
        await user.click(
          within(row).getByRole('button', {
            name: i18n.getFixedT(locale, 'common')('actions.openMenu'),
          }),
        );
        await user.click(
          await screen.findByRole('menuitem', {
            name: tSandboxes(`actions.${action}`),
          }),
        );

        await waitFor(() =>
          expect(toast).toHaveBeenCalledWith({
            title: tSandboxes('toast.error'),
            description: SESSION_ENDED[locale],
            variant: 'destructive',
          }),
        );
        expect(JSON.stringify(toast.mock.calls)).not.toContain('"code"');
      },
    );
  },
);
