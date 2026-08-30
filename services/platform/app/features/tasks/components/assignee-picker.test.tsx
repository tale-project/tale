// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AssignableAgent } from '../hooks/use-actor-directory';
import { AssigneePicker } from './assignee-picker';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

const mockAgents: AssignableAgent[] = [
  {
    type: 'agent',
    id: 'research-bot',
    name: 'Research Bot',
    displayCategory: 'agent',
  },
  {
    type: 'agent',
    id: 'software-developer',
    name: 'Software Developer',
    displayCategory: 'coding-agent',
  },
  {
    type: 'agent',
    id: 'image-bot',
    name: 'Image Bot',
    displayCategory: 'image-agent',
  },
];

let mockDirectoryAgents: AssignableAgent[] = mockAgents.filter(
  (a) => a.displayCategory !== 'image-agent',
);
let mockAgentsLoading = false;
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: () => ({
    assignableMembers: [
      { type: 'user', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
    ],
    assignableAgents: mockDirectoryAgents,
    // The unfiltered directory list is still returned for current-value display.
    agents: mockDirectoryAgents,
    agentsLoading: mockAgentsLoading,
    currentUserId: 'user-1',
    resolveActor: () => ({
      type: 'user',
      id: 'user-1',
      name: 'Alex',
      isAgent: false,
    }),
  }),
}));

// The subject-contract + handoff plumbing reaches Convex (provider-backed);
// these picker tests care about sections and warnings, so stub the seams.
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskContractAutomations: () => [],
}));
vi.mock('../hooks/mutations', () => ({
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-convex-client', () => ({
  useConvexClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn() }),
}));

describe('AssigneePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDirectoryAgents = mockAgents.filter(
      (a) => a.displayCategory !== 'image-agent',
    );
    mockAgentsLoading = false;
  });

  it('lists every assignable agent under one plain Agents section', async () => {
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );

    expect(screen.getByText('tasks.assignee.agents')).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.externalAgents'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('Software Developer')).toBeInTheDocument();
    expect(screen.queryByText('Image Bot')).not.toBeInTheDocument();
  });

  it('offers Create an agent when the project has none — the capability must not be invisible', async () => {
    mockDirectoryAgents = [];
    const onAssign = vi.fn();
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        projectId={'project-1' as string}
        onAssign={onAssign}
        onUnassign={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );

    // The section header still frames it as the Agents lane.
    expect(screen.getByText('tasks.assignee.agents')).toBeInTheDocument();
    expect(
      screen.getByText('tasks.assignee.createAgentHint'),
    ).toBeInTheDocument();

    await user.click(screen.getByText('tasks.assignee.createAgent'));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/agents',
      params: { id: 'org-1', projectId: 'project-1' },
    });
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('stays quiet about creating agents while the list is loading or without a project', async () => {
    mockDirectoryAgents = [];
    mockAgentsLoading = true;
    const first = render(
      <AssigneePicker
        organizationId="org-1"
        projectId={'project-1' as string}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );
    await first.user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
    first.unmount();

    // No project bound (org-level picker) — nowhere to send the user.
    mockAgentsLoading = false;
    const second = render(
      <AssigneePicker
        organizationId="org-1"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );
    await second.user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
  });

  it('keeps the create-agent row out of a picker that has agents', async () => {
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        projectId={'project-1' as string}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.assignee.createAgent'),
    ).not.toBeInTheDocument();
  });

  it('shows section-level info tooltips, not per-agent hints', async () => {
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );

    expect(
      screen.queryByText('tasks.assignee.agentsInfo'),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'common.aria.moreInfo' }),
    ).toHaveLength(1);
  });

  it('shows non-code warning when an external agent is assigned to a generic task', () => {
    render(
      <AssigneePicker
        organizationId="org-1"
        assigneeType="agent"
        assigneeId="software-developer"
        taskTitle="Write quarterly summary"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    expect(
      screen.getByText('tasks.assignee.nonCodeWarning'),
    ).toBeInTheDocument();
  });

  it('keeps the non-code warning out of compact pickers that omit task context', () => {
    render(
      <AssigneePicker
        organizationId="org-1"
        assigneeType="agent"
        assigneeId="software-developer"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    expect(
      screen.queryByText('tasks.assignee.nonCodeWarning'),
    ).not.toBeInTheDocument();
  });

  it('places afterTrigger beside the avatar, above the non-code warning', () => {
    render(
      <AssigneePicker
        organizationId="org-1"
        assigneeType="agent"
        assigneeId="software-developer"
        taskTitle="Write quarterly summary"
        afterTrigger={<span>Software Developer</span>}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    const warning = screen.getByText('tasks.assignee.nonCodeWarning');
    const name = screen.getByText('Software Developer');
    expect(
      warning.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('hints that only live agents are listed, when the Agents section is present (#2610)', async () => {
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );

    expect(
      screen.getByText('tasks.assignee.liveAgentsOnly'),
    ).toBeInTheDocument();
  });

  it('still hints that only live agents are listed when no agent is live at all (#2610)', async () => {
    // The exact "connected GitHub, but Issue Triager still isn't assignable"
    // repro: no agent clears the liveness filter, so the Agents section
    // itself doesn't render — the hint is the only place left to explain why.
    mockDirectoryAgents = [];
    const { user } = render(
      <AssigneePicker
        organizationId="org-1"
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.actions.assign' }),
    );

    expect(screen.queryByText('tasks.assignee.agents')).not.toBeInTheDocument();
    expect(
      screen.getByText('tasks.assignee.liveAgentsOnly'),
    ).toBeInTheDocument();
  });
});
