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
    taskDispatchHintKey: 'agent-platform',
  },
  {
    type: 'agent',
    id: 'software-developer',
    name: 'Software Developer',
    displayCategory: 'coding-agent',
    taskDispatchHintKey: 'coding-sandbox-only',
  },
  {
    type: 'agent',
    id: 'image-bot',
    name: 'Image Bot',
    displayCategory: 'image-agent',
    taskDispatchHintKey: null,
  },
];

let mockDirectoryAgents: AssignableAgent[] = mockAgents.filter(
  (a) => a.displayCategory !== 'image-agent',
);

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [
      { type: 'user', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
    ],
    agents: mockDirectoryAgents,
    currentUserId: 'user-1',
    resolveActor: () => ({
      type: 'user',
      id: 'user-1',
      name: 'Alex',
      isAgent: false,
    }),
  }),
}));

describe('AssigneePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDirectoryAgents = mockAgents.filter(
      (a) => a.displayCategory !== 'image-agent',
    );
  });

  it('groups platform agents and coding agents with section headers', async () => {
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
    expect(screen.getByText('tasks.assignee.codingAgents')).toBeInTheDocument();
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('Software Developer')).toBeInTheDocument();
    expect(screen.queryByText('Image Bot')).not.toBeInTheDocument();
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
      screen.queryByText('tasks.assignee.dispatchHints.codingSandboxOnly'),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'common.aria.moreInfo' }),
    ).toHaveLength(2);
  });

  it('shows non-code warning when a coding agent is assigned to a generic task', () => {
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
