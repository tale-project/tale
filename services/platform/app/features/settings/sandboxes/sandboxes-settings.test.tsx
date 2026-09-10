import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveEditorProvider, EditorGroup } from '@/app/components/ui/editor';
import { render, screen, within } from '@/tests/utils/render';

import { SandboxesSettings } from './sandboxes-settings';

const { state, query, mutate, refreshCapacity, refreshLimits } = vi.hoisted(
  () => ({
    state: { canRead: true, canManage: false, abilityLoading: false },
    query: vi.fn(),
    mutate: vi.fn(),
    refreshCapacity: vi.fn(),
    refreshLimits: vi.fn(),
  }),
);

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
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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
        ]
      : name.endsWith(':getSandboxQuotaUsage')
        ? [
            { budget: 'project', used: 1, cap: 2 },
            { budget: 'workflow', used: 0, cap: 2 },
            { budget: 'render', used: 0, cap: 2 },
          ]
        : name.endsWith(':getSandboxDeploymentLimits')
          ? { status: 'available', maxSessions: 16 }
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
    expect(screen.queryByText('Restricted project')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
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
    const headers = screen
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
