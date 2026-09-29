// @vitest-environment jsdom
import type { TaskSubjectContract } from '@tale/shared/schemas/task-contract';
import { AppShell } from '@tale/ui/app-shell';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';

import type { TaskStatus } from '../lib/display';
import { useTaskStatusChoreography } from './use-task-status-choreography';

// Moving an automation-owned task out of In progress while its run is live:
// ONE write stops the run and lands the card where it was moved, so an open
// column never passes through Cancelled (the close its open subtasks
// refuse), and a refused close names its reason and stops nothing.

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
  query: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (action: string) => ({
    mutateAsync:
      action === 'tasks/public_actions:cancelTaskWorkflow'
        ? mocks.stop
        : mocks.start,
  }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: mocks.query }),
}));
vi.mock('./mutations', () => ({
  useStartTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));

const contract: TaskSubjectContract = {
  workflow: 'supplier-desk',
  start: { when: 'status == todo' },
};

vi.mock('./use-task-subject-contract', () => ({
  useTaskContractAutomations: () => [],
  resolveTaskOwnership: () => ({
    kind: 'automation',
    contract,
    automationSlug: 'supplier-desk',
    displayName: 'Supplier desk',
  }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: mocks.toast }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

const PARENT = {
  _id: 'task-1',
  projectId: 'project-1',
  status: 'in_progress',
  createdBy: 'user-1',
  createdByType: 'user' as const,
  assigneeType: 'app' as const,
  assigneeId: 'supplier-desk',
};

async function move(to: TaskStatus, placement?: Record<string, string>) {
  const view = renderHook(
    () =>
      useTaskStatusChoreography('org-1', 'project-1', {
        confirmCancel: mocks.confirm,
      }),
    { wrapper },
  );
  await waitFor(() => expect(view.result.current).toBeTypeOf('function'));
  return view.result.current(PARENT, to, placement);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('user-locale', 'en-US');
  // The run working the task is live.
  mocks.query.mockImplementation(async (query: string) =>
    query === 'automations/queries:getLiveRunForTask'
      ? { runId: 'run-1', status: 'waiting' }
      : null,
  );
  mocks.confirm.mockResolvedValue(true);
  mocks.stop.mockResolvedValue({
    taskCancelled: false,
    executionCancelled: true,
    executionId: 'run-1',
  });
});

describe('useTaskStatusChoreography — leaving a live In progress', () => {
  it.each(['todo', 'backlog', 'in_review', 'done', 'cancelled'] as const)(
    'stops the run and lands the card in %s with one write',
    async (to) => {
      const outcome = await move(to);

      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({
        organizationId: 'org-1',
        taskId: 'task-1',
        status: to,
      });
      // The stop moved the card: the caller owes no second status write.
      expect(outcome).toBe('handled');
      expect(mocks.toast).toHaveBeenCalledWith({
        title: 'The run was cancelled.',
      });
    },
  );

  it('carries the board drop position into the same write', async () => {
    const outcome = await move('todo', {
      beforeTaskId: 'card-above',
      afterTaskId: 'card-below',
    });

    expect(outcome).toBe('handled');
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      taskId: 'task-1',
      status: 'todo',
      beforeTaskId: 'card-above',
      afterTaskId: 'card-below',
    });
  });

  it('names the open subtasks when a close is refused, and blocks the move', async () => {
    mocks.stop.mockRejectedValue(
      new AppError({
        code: 'TASK_HAS_OPEN_SUBTASKS',
        message: 'Open subtasks remain',
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await move('done');

    expect(outcome).toBe('blocked');
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Finish all subtasks before closing this task.',
      description: undefined,
      variant: 'destructive',
    });
  });

  it('says why any other failure happened under the generic title', async () => {
    mocks.stop.mockRejectedValue(
      new AppError({
        code: 'PROJECT_ARCHIVED',
        message: 'Project is archived',
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await move('todo');

    expect(outcome).toBe('blocked');
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title:
        'Something went wrong — try again, or reload the page if it keeps happening.',
      description: 'Project is archived',
      variant: 'destructive',
    });
  });

  it('keeps the run when the person declines the confirm', async () => {
    mocks.confirm.mockResolvedValue(false);

    const outcome = await move('todo');

    expect(outcome).toBe('blocked');
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('leaves a settled run alone: the plain move is the caller’s', async () => {
    mocks.query.mockResolvedValue(null);

    const outcome = await move('todo');

    expect(outcome).toBe('move');
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
});
