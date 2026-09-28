// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRepeat } from '@/lib/shared/task-repeat';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { TaskRepeatStopButton } from './task-repeat-stop-button';

const mocks = vi.hoisted(() => ({
  stopRepeat: vi.fn(),
  query: vi.fn(),
  next: null as Record<string, unknown> | null,
}));

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useTask: (taskId: string | undefined) => ({
    task: taskId === mocks.next?._id ? mocks.next : null,
    canEdit: true,
    canComment: true,
    isLoading: mocks.next === null,
    error: null,
    notFound: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'tasks/mutations:stopTaskRepeat'
        ? mocks.stopRepeat
        : vi.fn(async () => null),
    isPending: false,
  }),
}));
vi.mock('@/app/lib/backend/prefetch', () => ({
  ensureAdaptedQueryData: (_client: unknown, name: string, args: unknown) =>
    mocks.query(name, args),
}));
vi.mock('@/app/lib/backend/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/adapters')>()),
  activeOrganizationId: () => 'org-1',
}));

const TASK_ID = 'task-closed';
const NEXT_ID = 'task-next';

const weekly: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: 'Europe/Zurich',
};

/** The next task as its read answers it. */
function nextTask(repeat?: TaskRepeat) {
  return {
    _id: NEXT_ID,
    projectId: 'project-1',
    number: 8,
    title: 'Water the plants',
    status: 'todo',
    ...(repeat ? { repeat } : {}),
  };
}

const REPEAT_CONTROL_ID = 'repeat-control';

function renderButton() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <button type="button" id={REPEAT_CONTROL_ID}>
        Repeat
      </button>
      <TaskRepeatStopButton
        taskId={TASK_ID}
        nextTaskId={NEXT_ID}
        returnFocusTo={REPEAT_CONTROL_ID}
      />
      <button type="button">Elsewhere</button>
      <Toaster />
    </QueryClientProvider>,
  );
}

function repeatControl() {
  return screen.getByRole('button', { name: 'Repeat' });
}

function stopButton() {
  return screen.queryByRole('button', { name: 'Stop repeating' });
}

beforeEach(() => {
  mocks.stopRepeat.mockReset();
  mocks.query.mockReset();
  mocks.next = nextTask(weekly);
  mocks.query.mockImplementation(async (name: string) =>
    name === 'tasks/queries:getTask'
      ? { task: nextTask(), canEdit: true, canComment: true }
      : { key: 'OPS' },
  );
});

describe('TaskRepeatStopButton — when it shows', () => {
  it('offers the stop while the next task still carries the series', async () => {
    const { container } = renderButton();
    const button = stopButton();
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
    // The panel's row rhythm, and a target well over 24px.
    expect(button).toHaveClass('h-7');
    await checkAccessibility(container);
  });

  it('shows nothing while the next task loads', () => {
    mocks.next = null;
    renderButton();
    expect(stopButton()).toBeNull();
  });

  // Someone set the next task to Never, or the series was stopped: there
  // is nothing left to stop.
  it('shows nothing once the next task no longer repeats', () => {
    mocks.next = nextTask();
    renderButton();
    expect(stopButton()).toBeNull();
  });
});

describe('TaskRepeatStopButton — stopping', () => {
  it('is reached from the keyboard and takes the untouched next task back', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: true });
    const { user } = renderButton();
    await user.tab();
    await user.tab();
    expect(stopButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mocks.stopRepeat).toHaveBeenCalledOnce();
    // The next task's id rides along so its reads are held back while it
    // may be taken back.
    expect(mocks.stopRepeat).toHaveBeenCalledWith({
      taskId: TASK_ID,
      nextTaskId: NEXT_ID,
    });
    expect(await screen.findByText('Repeat stopped')).toBeInTheDocument();
    expect(screen.getByText('The next task was removed.')).toBeInTheDocument();
    expect(mocks.query).not.toHaveBeenCalled();
    // Gone at once, before the reads catch up with the stop — and focus
    // goes on to the Repeat control instead of falling back to the page.
    expect(stopButton()).toBeNull();
    expect(repeatControl()).toHaveFocus();
  });

  // Someone already changed the next task: it stays, named by its
  // identifier, and only stops repeating.
  it('names a next task that was already changed and stays', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: false });
    const { user } = renderButton();
    await user.click(stopButton() as HTMLElement);
    expect(
      await screen.findByText(
        "OPS-8 was already changed, so it stays — it just won't repeat.",
      ),
    ).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith('tasks/queries:getTask', {
      organizationId: 'org-1',
      taskId: NEXT_ID,
    });
    expect(stopButton()).toBeNull();
    expect(repeatControl()).toHaveFocus();
  });

  // The stop takes a round trip; someone who moved on meanwhile keeps
  // their place.
  it('leaves focus where someone moved it while the stop ran', async () => {
    let answer: (value: { removedNextTask: boolean }) => void = () => {};
    mocks.stopRepeat.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { user } = renderButton();
    await user.click(stopButton() as HTMLElement);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    await act(async () => {
      answer({ removedNextTask: true });
    });
    await waitFor(() => expect(stopButton()).toBeNull());
    expect(elsewhere).toHaveFocus();
  });

  it('offers the action again when the mounted panel changes to another task', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: true });
    const control = (taskId: string, nextTaskId: string) => (
      <TaskRepeatStopButton taskId={taskId} nextTaskId={nextTaskId} />
    );
    const { user, rerender } = render(control(TASK_ID, NEXT_ID));
    await user.click(stopButton() as HTMLElement);
    await waitFor(() => expect(stopButton()).toBeNull());

    mocks.next = { ...nextTask(weekly), _id: 'other-next' };
    rerender(control('other-task', 'other-next'));
    expect(stopButton()).toBeInTheDocument();
    await user.click(stopButton() as HTMLElement);
    expect(mocks.stopRepeat).toHaveBeenLastCalledWith({
      taskId: 'other-task',
      nextTaskId: 'other-next',
    });
  });

  it('does not hide another task’s action when an earlier stop resolves', async () => {
    let answer: (value: { removedNextTask: boolean }) => void = () => {};
    mocks.stopRepeat.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const control = (taskId: string, nextTaskId: string) => (
      <>
        <button type="button" id={REPEAT_CONTROL_ID}>
          Repeat
        </button>
        <TaskRepeatStopButton
          taskId={taskId}
          nextTaskId={nextTaskId}
          returnFocusTo={REPEAT_CONTROL_ID}
        />
      </>
    );
    const { user, rerender } = render(control(TASK_ID, NEXT_ID));
    await user.click(stopButton() as HTMLElement);
    mocks.next = { ...nextTask(weekly), _id: 'other-next' };
    rerender(control('other-task', 'other-next'));
    const currentButton = stopButton() as HTMLElement;
    currentButton.focus();
    await act(async () => {
      answer({ removedNextTask: true });
    });
    expect(stopButton()).toBe(currentButton);
    expect(currentButton).toHaveFocus();
  });

  it('still restores focus when the same task refreshes before the stop answers', async () => {
    let answer: (value: { removedNextTask: boolean }) => void = () => {};
    mocks.stopRepeat.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const control = () => (
      <>
        <button type="button" id={REPEAT_CONTROL_ID}>
          Repeat
        </button>
        <TaskRepeatStopButton
          taskId={TASK_ID}
          nextTaskId={NEXT_ID}
          returnFocusTo={REPEAT_CONTROL_ID}
        />
      </>
    );
    const { user, rerender } = render(control());
    await user.click(stopButton() as HTMLElement);
    mocks.next = nextTask();
    rerender(control());
    expect(stopButton()).toBeNull();
    await act(async () => {
      answer({ removedNextTask: true });
    });
    expect(repeatControl()).toHaveFocus();
  });

  // The write's own error toast reports the failure; the button stays for
  // another try, and nothing claims success.
  it('stays, claiming nothing, when the stop fails', async () => {
    mocks.stopRepeat.mockRejectedValue(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { user } = renderButton();
    // One toast shows at a time: a success toast would replace this one.
    act(() => {
      toast({ title: 'Earlier news' });
    });
    await user.click(stopButton() as HTMLElement);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByText('Earlier news')).toBeInTheDocument();
    expect(screen.queryByText('Repeat stopped')).not.toBeInTheDocument();
    expect(stopButton()).toBeInTheDocument();
    expect(stopButton()).toHaveFocus();
    warn.mockRestore();
  });
});
