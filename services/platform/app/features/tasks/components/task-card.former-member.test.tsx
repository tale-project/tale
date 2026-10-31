import { DndContext } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import type { StandInMember } from '@/tests/utils/member-lookup-stand-in';
import { render, screen, within } from '@/tests/utils/render';

import { TaskBoardProvider } from './task-board-context';
import { TaskCard, type TaskRow } from './task-card';

/**
 * A card waiting on the review of a member who was removed from the
 * organization, and still assigned to them. The board names that person
 * through the real actor directory: the review line says it waits on a
 * former member, in a sentence of the reader's language, and the assignee's
 * avatar is named "Former member" — never their raw user id (#3788). The
 * member lookup answers from the fixtures below.
 */

/** The removed member's id, as the task still stores it. */
const GONE = 'pTqO7Cn7D9MmBLjW1v2p9yne5Ed1BxOb';

const state = vi.hoisted(() => ({
  locale: 'en',
  members: undefined as StandInMember[] | undefined,
}));

vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => state.members,
  ),
);
vi.mock('@/lib/i18n/client', () => ({
  useT: (namespace: string) => ({ t: i18n.getFixedT(state.locale, namespace) }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    if (args === 'skip') return { data: undefined, isLoading: false };
    const answers: Record<string, unknown> = {
      'members/queries:listByOrganization': state.members,
      'automations/queries:listAutomations': [],
      'projects/queries:listProjectAgents': [],
      'projects/queries:listServingAgents': [],
    };
    return { data: answers[name], isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'u-owner' } }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));
vi.mock('../hooks/mutations', () => ({
  useAssignTask: () => ({ mutate: vi.fn() }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
}));

const MEMBERS = [
  {
    _id: 'member-owner',
    organizationId: 'org_test',
    userId: 'u-owner',
    role: 'owner' as const,
    createdAt: 0,
    displayName: 'Olive Owner',
    email: 'olive@example.com',
    twoFactorEnabled: false,
  },
];

const task: TaskRow = {
  _id: 'review-task',
  _creationTime: 0,
  organizationId: 'org_test',
  projectId: 'project_test',
  title: 'Draft the handover note',
  status: 'in_review',
  rank: 'a0',
  number: 1,
  createdBy: GONE,
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
  assigneeType: 'user',
  assigneeId: GONE,
  reviewerUserId: GONE,
};

function renderCard() {
  return render(
    <DndContext>
      <TaskBoardProvider tasks={[task]} dependencyEdges={[]}>
        <TaskCard task={task} canWorkTask={() => true} />
      </TaskBoardProvider>
    </DndContext>,
  );
}

/** Everything a reader or their screen reader is given. */
function exposedWords(): string {
  const attributes = [
    ...document.querySelectorAll('[aria-label], [title], [alt]'),
  ].flatMap((element) =>
    ['aria-label', 'title', 'alt'].map(
      (attribute) => element.getAttribute(attribute) ?? '',
    ),
  );
  return [document.body.textContent ?? '', ...attributes].join('\n');
}

beforeEach(() => {
  state.members = MEMBERS;
});

afterEach(() => {
  state.locale = 'en';
});

describe.each([
  ['en', 'Former member', 'Waiting on a former member'],
  ['de', 'Ehemaliges Mitglied', 'Wartet auf ein ehemaliges Mitglied'],
  ['fr', 'Ancien membre', "En attente d'un ancien membre"],
])('TaskCard — a removed member in %s', (locale, formerMember, waiting) => {
  beforeEach(() => {
    state.locale = locale;
  });

  it('says the review waits on a former member', () => {
    renderCard();
    expect(screen.getAllByText(waiting).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: task.title }),
    ).toHaveAccessibleDescription(new RegExp(waiting));
  });

  it('names the assignee’s avatar a former member, never by their id', () => {
    renderCard();
    const assign = screen.getByRole('button', {
      name: i18n.getFixedT(locale, 'tasks')('actions.assign'),
    });
    const avatar = within(assign).getByRole('img', { name: formerMember });
    // No initials of a person who is not there.
    expect(avatar).toHaveTextContent('');
    expect(exposedWords()).not.toContain(GONE);
  });
});

describe('TaskCard — before the member directory answers', () => {
  it('waits on nobody in particular and names nobody', () => {
    state.members = undefined;
    renderCard();
    expect(
      screen.getByRole('button', { name: task.title }),
    ).toHaveAccessibleDescription(/Needs review/);
    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(within(assign).queryByRole('img')).not.toBeInTheDocument();
    expect(exposedWords()).not.toContain(GONE);
    expect(exposedWords()).not.toContain('Former member');
  });
});
