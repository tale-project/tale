// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act } from 'react';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskActorType } from '../lib/display';
import { AssigneePicker } from './assignee-picker';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

const { mockQuery, mockCancelWorkflow, mockCancelAgentRun } = vi.hoisted(
  () => ({
    mockQuery: vi.fn(),
    mockCancelWorkflow: vi.fn(),
    mockCancelAgentRun: vi.fn(),
  }),
);

vi.mock('../hooks/use-actor-directory', () => {
  const resolveActor = (type: string, id: string) => ({
    type,
    id,
    name: id,
    isAgent: type !== 'user',
  });
  return {
    useProvidedActorDirectory: () => undefined,
    useActorDirectory: () => ({ currentUserId: 'user-1', resolveActor }),
    useAssignableActors: () => ({
      assignableMembers: [
        { type: 'user', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
        { type: 'user', id: 'user-2', name: 'Bea', email: 'bea@example.com' },
      ],
      assignableAgents: [],
      agentsLoading: false,
      currentUserId: 'user-1',
      resolveActor,
      canAddAgents: false,
      projectResolved: true,
      standardAgentAvailable: false,
    }),
  };
});
vi.mock(
  '@/app/features/projects/components/project-agent-create-dialog',
  () => ({ ProjectAgentCreateDialog: () => null }),
);
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskContractAutomations: () => [],
}));
vi.mock('../hooks/mutations', () => ({
  useCancelTaskAgentRun: () => ({ mutateAsync: mockCancelAgentRun }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: mockQuery, mutation: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: mockCancelWorkflow }),
}));

/** What the live-run reads find for a task. */
let liveRuns: Record<string, 'automation' | 'agent' | undefined> = {};
/** Tasks whose live-run reads are held until `answer(taskId)`. */
let held: Map<string, { answered: Promise<void>; release: () => void }>;

function hold(taskId: string) {
  let release = () => {};
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  held.set(taskId, { answered, release });
}

async function answer(taskId: string) {
  await act(async () => {
    held.get(taskId)?.release();
  });
}

interface Task {
  taskId: string;
  assigneeType: TaskActorType;
  assigneeId: string;
  onAssign: Mock<(type: TaskActorType, id: string) => void>;
}

function task(
  taskId: string,
  assigneeType: TaskActorType,
  assigneeId: string,
): Task {
  return {
    taskId,
    assigneeType,
    assigneeId,
    onAssign: vi.fn<(type: TaskActorType, id: string) => void>(),
  };
}

/** The task modal's picker: one element that moves from task to task. */
const picker = (t: Task) => (
  <AssigneePicker
    organizationId="org-1"
    projectId="project-1"
    taskId={t.taskId}
    assigneeType={t.assigneeType}
    assigneeId={t.assigneeId}
    onAssign={t.onAssign}
    onUnassign={vi.fn()}
  />
);

async function pick(user: ReturnType<typeof render>['user'], name: string) {
  await user.click(
    screen.getByRole('button', { name: 'tasks.actions.assign' }),
  );
  await user.click(screen.getByRole('option', { name: new RegExp(name) }));
}

const confirmTitle = 'tasks.assignee.handoffConfirmTitle';

describe('AssigneePicker handoff across tasks (#3915)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveRuns = {};
    held = new Map();
    mockQuery.mockImplementation(
      async (name: string, args: { taskId: string }) => {
        await held.get(args.taskId)?.answered;
        const live = liveRuns[args.taskId];
        if (name === 'automations/queries:getLiveRunForTask') {
          return live === 'automation' ? { _id: `run-${args.taskId}` } : null;
        }
        return live === 'agent'
          ? { _id: `agent-run-${args.taskId}`, status: 'running' }
          : null;
      },
    );
    mockCancelWorkflow.mockResolvedValue(undefined);
    mockCancelAgentRun.mockResolvedValue(undefined);
  });

  it('asks before taking a task from its automation, then cancels that task’s run and reassigns it', async () => {
    const a = task('task-a', 'app', 'invoice-flow');
    liveRuns = { 'task-a': 'automation' };
    const { user } = render(picker(a));

    await pick(user, 'Alex');
    expect(await screen.findByText(confirmTitle)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'tasks.assignee.handoffConfirmAction',
      }),
    );

    await vi.waitFor(() =>
      expect(a.onAssign).toHaveBeenCalledWith('user', 'user-1'),
    );
    expect(mockCancelWorkflow).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      taskId: 'task-a',
    });
  });

  it('drops a handoff whose live-run read answers after the picker moved to another task', async () => {
    const a = task('task-a', 'app', 'invoice-flow');
    const b = task('task-b', 'app', 'invoice-flow');
    liveRuns = { 'task-a': 'automation', 'task-b': 'automation' };
    hold('task-a');
    const { user, rerender } = render(picker(a));

    await pick(user, 'Alex');
    // The parent link opens the parent task in the same modal and picker.
    rerender(picker(b));
    await answer('task-a');

    expect(screen.queryByText(confirmTitle)).not.toBeInTheDocument();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const [, args] of mockQuery.mock.calls) {
      expect(args).toMatchObject({ taskId: 'task-a' });
    }
    expect(mockCancelWorkflow).not.toHaveBeenCalled();
    expect(b.onAssign).not.toHaveBeenCalled();
    expect(a.onAssign).not.toHaveBeenCalled();
  });

  it('closes a confirm the picker left behind on another task, cancelling nothing', async () => {
    const a = task('task-a', 'agent', 'research-bot');
    const b = task('task-b', 'agent', 'research-bot');
    liveRuns = { 'task-a': 'agent', 'task-b': 'agent' };
    const { user, rerender } = render(picker(a));

    await pick(user, 'Alex');
    expect(await screen.findByText(confirmTitle)).toBeInTheDocument();
    rerender(picker(b));

    expect(screen.queryByText(confirmTitle)).not.toBeInTheDocument();
    expect(mockCancelAgentRun).not.toHaveBeenCalled();
    expect(b.onAssign).not.toHaveBeenCalled();
  });

  it('still applies a change that needs no confirm to the task it was picked for', async () => {
    const a = task('task-a', 'user', 'user-2');
    const b = task('task-b', 'user', 'user-2');
    hold('task-a');
    const { user, rerender } = render(picker(a));

    await pick(user, 'Alex');
    rerender(picker(b));
    await answer('task-a');

    await vi.waitFor(() =>
      expect(a.onAssign).toHaveBeenCalledExactlyOnceWith('user', 'user-1'),
    );
    expect(b.onAssign).not.toHaveBeenCalled();
  });

  it('completes the next task’s own handoff while the first task’s read answers late', async () => {
    const a = task('task-a', 'app', 'invoice-flow');
    const b = task('task-b', 'app', 'invoice-flow');
    liveRuns = { 'task-a': 'automation', 'task-b': 'automation' };
    hold('task-a');
    const { user, rerender } = render(picker(a));

    await pick(user, 'Alex');
    rerender(picker(b));
    await pick(user, 'Bea');
    expect(await screen.findByText(confirmTitle)).toBeInTheDocument();
    await answer('task-a');
    await user.click(
      screen.getByRole('button', {
        name: 'tasks.assignee.handoffConfirmAction',
      }),
    );

    await vi.waitFor(() =>
      expect(b.onAssign).toHaveBeenCalledExactlyOnceWith('user', 'user-2'),
    );
    expect(mockCancelWorkflow).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      taskId: 'task-b',
    });
    expect(a.onAssign).not.toHaveBeenCalled();
    expect(screen.queryByText(confirmTitle)).not.toBeInTheDocument();
  });
});
