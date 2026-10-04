import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { TaskBoardProvider } from './task-board-context';
import { TaskCard, type TaskRow } from './task-card';
import {
  AgentNeedsAnswerIndicator,
  AgentWorkingIndicator,
  DueDateIndicator,
  RepeatIndicator,
  SubtaskProgress,
} from './task-indicators';

const state = vi.hoisted(() => ({ locale: 'en', currentUserId: 'viewer' }));

vi.mock('@/lib/i18n/client', () => ({
  useT: (namespace: string) => ({ t: i18n.getFixedT(state.locale, namespace) }),
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
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: state.currentUserId,
    resolveActor: () => ({ name: 'Ava Editor' }),
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    currentUserId: state.currentUserId,
    resolveActor: () => ({ name: 'Ava Editor' }),
  }),
}));
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

const task: TaskRow = {
  _id: 'review-task',
  _creationTime: 0,
  organizationId: 'org_test',
  projectId: 'project_test',
  title: 'Check the launch brief',
  status: 'in_review',
  rank: 'a0',
  number: 1,
  createdBy: 'owner',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
  reviewerUserId: 'ava',
  commentCount: 1,
};
const blocker: TaskRow = {
  ...task,
  _id: 'blocker',
  status: 'todo',
  title: 'Collect figures',
};

function renderCard(editable = false, overrides: Partial<TaskRow> = {}) {
  const row = { ...task, ...overrides };
  return render(
    <DndContext
      accessibility={{
        screenReaderInstructions: { draggable: 'Enter opens. Space picks up.' },
      }}
    >
      <TaskBoardProvider
        tasks={[row, blocker]}
        dependencyEdges={[
          { blockerTaskId: blocker._id, blockedTaskId: row._id },
        ]}
      >
        <TaskCard task={row} canWorkTask={() => editable} />
      </TaskBoardProvider>
    </DndContext>,
  );
}

afterEach(() => {
  state.locale = 'en';
  state.currentUserId = 'viewer';
});

describe('TaskCard state accessibility', () => {
  it('gives the other compact indicators valid image names', async () => {
    const { container } = render(
      <>
        <AgentWorkingIndicator working />
        <AgentNeedsAnswerIndicator asking />
        <DueDateIndicator dueDate={Date.UTC(2030, 0, 1)} status="todo" />
        <RepeatIndicator
          repeat={{ frequency: 'daily', interval: 1, timezone: 'UTC' }}
          status="todo"
        />
        <SubtaskProgress done={1} total={2} />
      </>,
    );
    expect(screen.getAllByRole('img')).toHaveLength(5);
    await checkAccessibility(container, {
      rules: { 'aria-prohibited-attr': { enabled: true } },
    });
  });
  it('has no prohibited names on card indicators', async () => {
    const { container } = renderCard();
    await checkAccessibility(container, {
      rules: { 'aria-prohibited-attr': { enabled: true } },
    });
  });
  it.each([false, true])(
    'describes the %s editable card before hover and passes axe',
    async (editable) => {
      const { container } = renderCard(editable);
      const title = screen.getByRole('button', { name: task.title });
      expect(title).toHaveAccessibleDescription(
        editable
          ? 'Enter opens. Space picks up. Blocked. Waiting on Ava Editor. 1 comment'
          : 'Blocked. Waiting on Ava Editor. 1 comment',
      );
      expect(
        container.querySelector('span[aria-label]:not([role])'),
      ).toBeNull();
      expect(screen.getByRole('img', { name: 'Blocked' })).toBeInTheDocument();
      expect(
        screen.getByRole('img', { name: 'Waiting on Ava Editor' }),
      ).toBeInTheDocument();
      await checkAccessibility(container, {
        rules: { 'aria-prohibited-attr': { enabled: true } },
      });
    },
  );

  it.each([false, true])(
    'shows state on keyboard focus (editable: %s) without indicator tab stops',
    async (editable) => {
      const { user, container } = renderCard(editable);
      const description = editable
        ? 'Enter opens. Space picks up. Blocked. Waiting on Ava Editor. 1 comment'
        : 'Blocked. Waiting on Ava Editor. 1 comment';
      await user.tab();
      expect(screen.getByRole('button', { name: task.title })).toHaveFocus();
      await waitFor(() =>
        expect(screen.getByRole('tooltip')).toHaveTextContent(
          'Blocked. Waiting on Ava Editor. 1 comment',
        ),
      );
      expect(container.querySelector('[role="img"][tabindex]')).toBeNull();
      expect(
        screen.getByRole('button', { name: task.title }),
      ).toHaveAccessibleDescription(description);
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole('button', { name: task.title }),
      ).toHaveAccessibleDescription(description);
    },
  );

  it.each([
    ['en', 1, '1 comment'],
    ['en', 2, '2 comments'],
    ['de', 1, '1 Kommentar'],
    ['de', 2, '2 Kommentare'],
    ['fr', 1, '1 commentaire'],
    ['fr', 2, '2 commentaires'],
  ])('uses the %s plural for %s comments', (locale, count, label) => {
    state.locale = locale;
    renderCard(false, { commentCount: count });
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: task.title }),
    ).toHaveAccessibleDescription(
      `${i18n.getFixedT(state.locale, 'tasks')('detail.blocked')}. ${i18n.getFixedT(state.locale, 'tasks')('review.waitingOn', { name: 'Ava Editor' })}. ${label}`,
    );
  });

  it('describes a review waiting on the viewer', () => {
    state.currentUserId = 'ava';
    renderCard();
    expect(
      screen.getByRole('button', { name: task.title }),
    ).toHaveAccessibleDescription('Blocked. Waiting on you. 1 comment');
  });

  it('omits review and comment state when absent', () => {
    renderCard(false, { status: 'todo', commentCount: 0 });
    expect(
      screen.getByRole('button', { name: task.title }),
    ).toHaveAccessibleDescription('Blocked');
  });
});
