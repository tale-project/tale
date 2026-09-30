// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AssignableActor } from '../hooks/use-actor-directory';
import { AssigneePicker } from './assignee-picker';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

const mockAgents: AssignableActor[] = [
  { type: 'agent', id: 'research-bot', name: 'Research Bot' },
  { type: 'agent', id: 'software-developer', name: 'Software Developer' },
];

let mockDirectoryAgents: AssignableActor[] = mockAgents;
let mockAgentsLoading = false;
// Who may add an agent, and whether the project read has answered: the
// directory reads the project the picker is bound to.
let mockCanAddAgents = true;
let mockProjectResolved = true;

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: (_organizationId: string, projectId?: string) => ({
    assignableMembers: [
      { type: 'user', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
    ],
    assignableAgents: projectId === undefined ? [] : mockDirectoryAgents,
    agentsLoading: mockAgentsLoading,
    currentUserId: 'user-1',
    resolveActor: () => ({
      type: 'user',
      id: 'user-1',
      name: 'Alex',
      isAgent: false,
    }),
    canAddAgents: projectId !== undefined && mockCanAddAgents,
    projectResolved: projectId !== undefined && mockProjectResolved,
  }),
}));

// The New agent form is its own component with its own reads; the picker
// only opens it and assigns what it creates.
vi.mock(
  '@/app/features/projects/components/project-agent-create-dialog',
  () => ({
    ProjectAgentCreateDialog: ({
      open,
      projectId,
      onCreated,
    }: {
      open: boolean;
      projectId: string;
      onCreated?: (agentId: string) => void;
    }) =>
      open ? (
        <div role="dialog" aria-label={`new agent in ${projectId}`}>
          <button type="button" onClick={() => onCreated?.('agent-new')}>
            create stub agent
          </button>
        </div>
      ) : null,
  }),
);

// The subject-contract + handoff plumbing reaches the backend; these picker
// tests care about sections and footers, so stub the seams.
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskContractAutomations: () => [],
}));
vi.mock('../hooks/mutations', () => ({
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));

function renderPicker(
  props: Partial<Parameters<typeof AssigneePicker>[0]> = {},
) {
  const onAssign = vi.fn();
  const view = render(
    <AssigneePicker
      organizationId="org-1"
      projectId={'project-1' as string | undefined}
      onAssign={onAssign}
      onUnassign={vi.fn()}
      {...props}
    />,
  );
  const open = () =>
    view.user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );
  return { ...view, onAssign, open };
}

describe('AssigneePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDirectoryAgents = mockAgents;
    mockAgentsLoading = false;
    mockCanAddAgents = true;
    mockProjectResolved = true;
  });

  it('lists every assignable agent under one plain Agents section', async () => {
    const { open } = renderPicker();
    await open();

    expect(screen.getByText('tasks.assignee.agents')).toBeInTheDocument();
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('Software Developer')).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
  });

  it('lets an editor create an agent in place and assigns the agent it creates', async () => {
    mockDirectoryAgents = [];
    const { user, open, onAssign } = renderPicker();
    await open();

    // The section header still frames it as the Agents lane.
    expect(screen.getByText('tasks.assignee.agents')).toBeInTheDocument();
    expect(
      screen.getByText('tasks.assignee.createAgentHint'),
    ).toBeInTheDocument();

    await user.click(screen.getByText('tasks.assignee.createAgent'));
    // Opened over the picker — nothing navigated away, nothing assigned yet.
    expect(
      screen.getByRole('dialog', { name: 'new agent in project-1' }),
    ).toBeInTheDocument();
    expect(onAssign).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'create stub agent' }));
    expect(onAssign).toHaveBeenCalledWith('agent', 'agent-new');
  });

  it('tells a reader who can add an agent instead of offering a door they cannot use', async () => {
    mockDirectoryAgents = [];
    mockCanAddAgents = false;
    const { open } = renderPicker();
    await open();

    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    // No empty Agents lane either: the fact is said once, as legible text.
    expect(screen.queryByText('tasks.assignee.agents')).not.toBeInTheDocument();
    expect(
      screen.getByText('tasks.assignee.noAgentsReader'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.liveAgentsOnlyReader'),
    ).not.toBeInTheDocument();
  });

  it('says nothing about adding agents while the agents or the project are loading', async () => {
    mockDirectoryAgents = [];
    mockAgentsLoading = true;
    const first = renderPicker();
    await first.open();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.noAgentsReader'),
    ).not.toBeInTheDocument();
    first.unmount();

    mockAgentsLoading = false;
    mockCanAddAgents = false;
    mockProjectResolved = false;
    const second = renderPicker();
    await second.open();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.noAgentsReader'),
    ).not.toBeInTheDocument();
  });

  it('stays quiet about adding agents without a project, or when the project read came back empty', async () => {
    mockDirectoryAgents = [];
    // No project bound (org-level picker): no agent can be assigned at all.
    const first = renderPicker({ projectId: undefined });
    await first.open();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.noAgentsReader'),
    ).not.toBeInTheDocument();
    first.unmount();

    mockCanAddAgents = false;
    mockProjectResolved = false;
    const second = renderPicker();
    await second.open();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.noAgentsReader'),
    ).not.toBeInTheDocument();
  });

  it('shows section-level info tooltips, not per-agent hints', async () => {
    const { open } = renderPicker();
    await open();

    expect(
      screen.queryByText('tasks.assignee.agentsInfo'),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'common.aria.moreInfo' }),
    ).toHaveLength(1);
  });

  it('renders afterTrigger beside the avatar and no advice under it', () => {
    render(
      <AssigneePicker
        organizationId="org-1"
        projectId="project-1"
        assigneeType="agent"
        assigneeId="software-developer"
        afterTrigger={<span>Software Developer</span>}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    const name = screen.getByText('Software Developer');
    // The trigger row is the whole control: nothing stacked below it.
    expect(name.parentElement?.childElementCount).toBe(2);
  });

  it('hints to an editor that only live agents are listed (#2610)', async () => {
    const { open } = renderPicker();
    await open();

    expect(
      screen.getByText('tasks.assignee.liveAgentsOnly'),
    ).toBeInTheDocument();
  });

  it('words the live-agents hint for a reader, who cannot add agents (#2610)', async () => {
    mockCanAddAgents = false;
    const { open } = renderPicker();
    await open();

    expect(
      screen.getByText('tasks.assignee.liveAgentsOnlyReader'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.liveAgentsOnly'),
    ).not.toBeInTheDocument();
  });

  it('still hints that only live agents are listed when no project is bound (#2610)', async () => {
    // The exact "connected GitHub, but Issue Triager still isn't assignable"
    // repro: no agent is assignable, so the Agents section itself doesn't
    // render — the hint is the only place left to explain why.
    mockDirectoryAgents = [];
    const { open } = renderPicker({ projectId: undefined });
    await open();

    expect(screen.queryByText('tasks.assignee.agents')).not.toBeInTheDocument();
    expect(
      screen.getByText('tasks.assignee.liveAgentsOnlyReader'),
    ).toBeInTheDocument();
  });
});
