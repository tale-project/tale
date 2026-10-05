// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {
  TaskReviewer,
  ProjectTaskReviewer,
} from '@tale/shared/schemas/task-review';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AssignableActor } from '../hooks/use-actor-directory';
import { ReviewerPicker } from './reviewer-picker';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, values?: { reviewer?: string }) =>
      `${ns}.${key}${values?.reviewer ? ': ' + values.reviewer : ''}`,
  }),
}));
const members: AssignableActor[] = [
  {
    type: 'user',
    id: 'user-1',
    name: 'Alex',
    email: 'alex@example.com',
    role: 'editor',
  },
  {
    type: 'user',
    id: 'user-2',
    name: 'Bea',
    email: 'bea@example.com',
    role: 'owner',
  },
  {
    type: 'user',
    id: 'user-3',
    name: 'Cara',
    email: 'cara@example.com',
    role: 'member',
  },
  { type: 'user', id: 'user-4', name: 'Dan', email: 'dan@example.com' },
];
const agents: AssignableActor[] = [
  { type: 'agent', id: 'worker', name: 'Worker', tools: ['task_review'] },
  {
    type: 'agent',
    id: 'reviewer',
    name: 'Independent reviewer',
    tools: ['task_review'],
  },
  { type: 'agent', id: 'drafter', name: 'Drafting agent', tools: [] },
];
let scopeReady = true;
let agentsLoading = false;
/** Renders that read the candidate lists (project access, roster). */
let candidateReads = 0;
const resolveActor = (type: string, id: string) => ({
  type,
  id,
  name: [...members, ...agents].find((actor) => actor.id === id)?.name ?? id,
  isAgent: type === 'agent',
});
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  // The closed picker names its reviewer from the directory alone.
  useActorDirectory: () => ({ resolveActor, currentUserId: 'user-2' }),
  useAssignableActors: () => {
    candidateReads += 1;
    return {
      assignableMembers: members,
      assignableAgents: agents,
      scopeReady,
      agentsLoading,
      currentUserId: 'user-2',
      resolveActor,
    };
  },
}));
const inherited: TaskReviewer = { kind: 'inherit' };
const humanDefault: ProjectTaskReviewer = { kind: 'human_default' };
const base = {
  organizationId: 'org-1',
  projectId: 'project-1',
  reviewer: inherited,
  projectReviewer: humanDefault,
};

describe('ReviewerPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scopeReady = true;
    agentsLoading = false;
    candidateReads = 0;
  });

  // A task's dialog carries a reviewer picker that is usually never opened:
  // its candidate reads and its list wait for its first use.
  it('reads no candidates until its first use, then opens with them', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ReviewerPicker
        {...base}
        onChange={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    );
    expect(candidateReads).toBe(0);
    expect(screen.queryByRole('option')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(candidateReads).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Alex/ })).toBeInTheDocument();
    // The list mounts open; the caller still hears that it opened.
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('offers scoped editors and agents, with a separate inherited choice', async () => {
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(screen.getByRole('option', { name: /Alex/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Bea/ })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Independent reviewer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Cara')).not.toBeInTheDocument();
    expect(screen.queryByText('Dan')).not.toBeInTheDocument();
    expect(screen.getByText('tasks.reviewer.routingHint')).toBeInTheDocument();
  });

  it('does not expose unscoped people or agents while project access is loading', async () => {
    scopeReady = false;
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(screen.queryByText('Independent reviewer')).not.toBeInTheDocument();
    expect(screen.getByText('common.actions.loading')).toBeInTheDocument();
  });

  it('keeps agent choices unavailable until the project roster is loaded', async () => {
    agentsLoading = true;
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(screen.getByRole('option', { name: /Alex/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Independent reviewer/ }),
    ).not.toBeInTheDocument();
  });

  it('emits typed people, agent and inherited selections', async () => {
    const onChange = vi.fn();
    const { user } = render(<ReviewerPicker {...base} onChange={onChange} />);
    for (const [name, expected] of [
      [/Alex/, { kind: 'user', userId: 'user-1' }],
      [/Independent reviewer/, { kind: 'agent', agentId: 'reviewer' }],
      [/tasks.reviewer.projectDefaultHuman/, { kind: 'inherit' }],
    ] as const) {
      await user.click(
        screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
      );
      await user.click(screen.getByRole('option', { name }));
      expect(onChange).toHaveBeenLastCalledWith(expected);
    }
  });

  it('blocks both direct and inherited self-review and supports keyboard selection', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ReviewerPicker
        {...base}
        projectReviewer={{ kind: 'agent', agentId: 'worker' }}
        implementationAgentId="worker"
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(screen.getByRole('option', { name: /^Worker/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      screen.getByRole('option', { name: /tasks.reviewer.projectDefault:/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByRole('combobox'), 'Independent');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({
      kind: 'agent',
      agentId: 'reviewer',
    });
  });

  it('greys an agent without the review grant, directly and as the inherited default', async () => {
    const { user } = render(
      <ReviewerPicker
        {...base}
        projectReviewer={{ kind: 'agent', agentId: 'drafter' }}
        onChange={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(
      screen.getByRole('option', { name: /^Drafting agent/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('option', { name: /tasks.reviewer.projectDefault:/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getAllByText('tasks.reviewer.agentPermissionRequired'),
    ).toHaveLength(2);
    expect(
      screen.getByRole('option', { name: /Independent reviewer/ }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('names the configured reviewer without an edit button for read-only users', () => {
    render(
      <ReviewerPicker
        {...base}
        reviewer={{ kind: 'agent', agentId: 'reviewer' }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'tasks.fields.reviewer' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Independent reviewer')).toBeInTheDocument();
  });
});
