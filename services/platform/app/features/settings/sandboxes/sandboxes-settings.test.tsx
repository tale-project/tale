import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveEditorProvider, EditorGroup } from '@/app/components/ui/editor';
import { render, screen } from '@/tests/utils/render';

import { SandboxesSettings } from './sandboxes-settings';

const { state, query, mutate } = vi.hoisted(() => ({
  state: { canRead: true, canManage: false },
  query: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string) =>
      action === 'write' ? state.canManage : state.canRead,
    cannot: (action: string) =>
      action === 'write' ? !state.canManage : !state.canRead,
  }),
  useAbilityLoading: () => false,
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
  mutate.mockReset();
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
            status: 'active',
            createdAt: 1_750_000_000_000,
            pinned: false,
            busy: false,
          },
        ]
      : name.endsWith(':getSandboxQuotaUsage')
        ? [
            { budget: 'project', used: 1, cap: 2 },
            { budget: 'workflow', used: 0, cap: 4 },
            { budget: 'render', used: 0, cap: 4 },
          ]
        : { status: 'unavailable', reason: 'unreachable' },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
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
