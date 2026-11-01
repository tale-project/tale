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
let agentsLoading = false;
/** Renders that read the candidate lists (the people, the roster). */
let candidateReads = 0;
/** The directory has not answered yet, so it names no member. */
let directoryPending = false;
const resolveActor = (type: string, id: string) => {
  if (directoryPending && type === 'user') {
    return { type, id, name: '', isAgent: false, standing: 'pending' };
  }
  return {
    type,
    id,
    name: [...members, ...agents].find((actor) => actor.id === id)?.name ?? id,
    isAgent: type === 'agent',
  };
};

interface PeopleFound {
  members: AssignableActor[];
  more: boolean;
  searching: boolean;
  unavailable: boolean;
}
// The server's search answers with the project's editors alone
// (`access=edit`): Cara, a member, and Dan, with no role, are never found.
const EDITORS: PeopleFound = {
  members: members.slice(0, 2),
  more: false,
  searching: false,
  unavailable: false,
};
let people: PeopleFound = EDITORS;
/** What each render searched the people for. */
const peopleSearches: Array<{
  projectId: string | undefined;
  query: string;
  access: string;
  chosenUserId: string | undefined;
}> = [];
vi.mock('../hooks/use-assignable-members', () => ({
  useAssignableMembers: (
    _organizationId: string,
    projectId: string | undefined,
    query: string,
    access: string,
    chosenUserId?: string,
  ) => {
    candidateReads += 1;
    peopleSearches.push({ projectId, query, access, chosenUserId });
    return people;
  },
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  // The closed picker names its reviewer from the directory alone.
  useActorDirectory: () => ({ resolveActor, currentUserId: 'user-2' }),
  useAssignableActors: () => {
    candidateReads += 1;
    return {
      subjectEntries: [],
      assignableAgents: agents,
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
/** The trigger's name: the field, then the reviewer it shows. */
const triggerName = (label: string) => `tasks.fields.reviewer: ${label}`;

describe('ReviewerPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsLoading = false;
    candidateReads = 0;
    directoryPending = false;
    people = EDITORS;
    peopleSearches.length = 0;
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
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
    );
    expect(candidateReads).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Alex/ })).toBeInTheDocument();
    // The list mounts open; the caller still hears that it opened.
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('offers the editors the search finds and agents, with a separate inherited choice', async () => {
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
    );
    expect(peopleSearches.at(-1)).toEqual({
      projectId: 'project-1',
      query: '',
      access: 'edit',
      chosenUserId: undefined,
    });
    expect(screen.getByRole('option', { name: /Alex/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Bea/ })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Independent reviewer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Cara')).not.toBeInTheDocument();
    expect(screen.queryByText('Dan')).not.toBeInTheDocument();
    expect(screen.getByText('tasks.reviewer.routingHint')).toBeInTheDocument();
  });

  it('searches the editors for what is typed, and says so until they answer', async () => {
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
    );
    people = { ...EDITORS, members: [], searching: true };
    await user.type(screen.getByRole('combobox'), 'zed');
    expect(peopleSearches.at(-1)).toEqual({
      projectId: 'project-1',
      query: 'zed',
      access: 'edit',
      chosenUserId: undefined,
    });
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(screen.getAllByText('common.actions.loading')).not.toHaveLength(0);
    expect(
      screen.queryByText('common.search.noResults'),
    ).not.toBeInTheDocument();
  });

  it('says when more people match than it shows, and when the search failed', async () => {
    people = { ...EDITORS, more: true };
    const first = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await first.user.click(
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
    );
    expect(screen.getByText('common.peopleSearch.more')).toBeInTheDocument();
    first.unmount();

    people = { ...EDITORS, members: [], unavailable: true };
    const second = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await second.user.click(
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
    );
    expect(
      screen.getByText('common.peopleSearch.unavailable'),
    ).toBeInTheDocument();
    // The agents stay offered: only the people could not be searched.
    expect(
      screen.getByRole('option', { name: /Independent reviewer/ }),
    ).toBeInTheDocument();
  });

  it('keeps the reviewer set on the task offered, and marked, whatever page the search found', async () => {
    // Erin was found on no page: the search keeps them offered because the
    // picker names them as its choice.
    const erin: AssignableActor = {
      type: 'user',
      id: 'user-5',
      name: 'Erin',
      email: 'erin@example.com',
      role: 'editor',
    };
    people = { ...EDITORS, members: [...EDITORS.members.slice(0, 1), erin] };
    const { user } = render(
      <ReviewerPicker
        {...base}
        reviewer={{ kind: 'user', userId: 'user-5' }}
        onChange={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /^tasks\.fields\.reviewer/ }),
    );
    expect(peopleSearches.at(-1)).toEqual({
      projectId: 'project-1',
      query: '',
      access: 'edit',
      chosenUserId: 'user-5',
    });
    expect(screen.getByRole('option', { name: /Erin/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Alex/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('keeps agent choices unavailable until the project roster is loaded', async () => {
    agentsLoading = true;
    const { user } = render(<ReviewerPicker {...base} onChange={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: triggerName('tasks.reviewer.none') }),
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
        screen.getByRole('button', {
          name: triggerName('tasks.reviewer.none'),
        }),
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
      screen.getByRole('button', { name: triggerName('Worker') }),
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
      screen.getByRole('button', { name: triggerName('Drafting agent') }),
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
      screen.queryByRole('button', { name: /^tasks\.fields\.reviewer/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Independent reviewer')).toBeInTheDocument();
  });

  // The trigger shows who reviews, so its name says it too, after the field
  // (WCAG 2.5.3 Label in Name): shut, and as the list's trigger once used.
  it.each([
    ['a member', { reviewer: { kind: 'user', userId: 'user-1' } }, 'Alex'],
    [
      'an agent',
      { reviewer: { kind: 'agent', agentId: 'reviewer' } },
      'Independent reviewer',
    ],
    [
      'the inherited project agent',
      { projectReviewer: { kind: 'agent', agentId: 'worker' } },
      'Worker',
    ],
    [
      'the inherited person the server resolved',
      { currentReviewer: { kind: 'user', userId: 'user-2' } },
      'Bea',
    ],
    ['nobody', {}, 'tasks.reviewer.none'],
  ] as const)(
    'names the reviewer it shows (%s) before and after its first use',
    async (_who, props, label) => {
      const name = triggerName(label);
      const { user } = render(
        <ReviewerPicker {...base} {...props} onChange={vi.fn()} />,
      );
      const closed = screen.getByRole('button', { name });
      expect(closed).toHaveTextContent(label);

      await user.click(closed);
      // The list it opens keeps the field's name.
      expect(
        screen.getByRole('listbox', { name: 'tasks.fields.reviewer' }),
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
      // Its first use mounted the list, whose trigger stands in its place.
      expect(candidateReads).toBeGreaterThan(0);
      const trigger = screen.getByRole('button', { name });
      expect(trigger).not.toBe(closed);
      expect(trigger).toHaveTextContent(label);
    },
  );

  // Until the directory names the member, the trigger shows no name, so the
  // field alone names it: no separator left dangling after it.
  it('names a reviewer the directory has not named yet by the field alone', async () => {
    directoryPending = true;
    const { user } = render(
      <ReviewerPicker
        {...base}
        reviewer={{ kind: 'user', userId: 'user-1' }}
        onChange={vi.fn()}
      />,
    );
    const closed = screen.getByRole('button', {
      name: 'tasks.fields.reviewer',
    });

    await user.click(closed);
    await user.keyboard('{Escape}');
    const trigger = screen.getByRole('button', {
      name: 'tasks.fields.reviewer',
    });
    expect(trigger).not.toBe(closed);
  });
});
