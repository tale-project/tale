import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
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

/** One project-agent op as the view lists it. */
function taskOp(execId: string, taskId: string, startedAt: number) {
  return {
    kind: 'task-agent' as const,
    execId,
    taskId,
    status: 'running',
    startedAt,
  };
}

/** Alice's workspace with three tasks executing in it at once — a project
 * agent runs its tasks concurrently in the one workspace it owns. */
const aliceRow = {
  sessionId: 'session-alice',
  ownerType: 'project_agent',
  ownerId: 'agent-alice',
  ownerLabel: 'Alice',
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
  currentOp: taskOp('exec-3', '3be051fb-0000-4000-8000-000000000003', 3),
  runningOps: [
    taskOp('exec-1', 'd01a4b15-0000-4000-8000-000000000001', 1),
    taskOp('exec-2', 'a91fb5c0-0000-4000-8000-000000000002', 2),
    taskOp('exec-3', '3be051fb-0000-4000-8000-000000000003', 3),
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
      ? [
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
        ]
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

  it('lists every task running in a workspace, not just the latest one', () => {
    renderSettings();
    const row = screen.getByText('Alice').closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText('3 project tasks'),
    ).toBeInTheDocument();
    for (const id of ['d01a4b15', 'a91fb5c0', '3be051fb']) {
      expect(within(row as HTMLElement).getByText(id)).toBeInTheDocument();
    }
    // Lifetime spend of the workspace, in dollars.
    expect(within(row as HTMLElement).getByText('$0.13')).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByText('claude-code'),
    ).toBeInTheDocument();
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
