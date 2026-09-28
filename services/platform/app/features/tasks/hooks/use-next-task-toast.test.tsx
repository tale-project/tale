// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskStatusWriteResult } from '@/app/lib/backend/contract/tasks';
import { render, screen, waitFor } from '@/tests/utils/render';

import { useNextTaskToast } from './use-next-task-toast';

const mocks = vi.hoisted(() => ({
  stopRepeat: vi.fn(),
  query: vi.fn(),
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

const CLOSED = 'task-closed';
const NEXT = { id: 'task-next', number: 8, dueDate: Date.UTC(2026, 9, 5, 12) };

/** A close that answers `result`, the way the status and move writes do. */
function Closer({ result }: { result: TaskStatusWriteResult }) {
  const announce = useNextTaskToast();
  return (
    <button type="button" onClick={() => announce(result, { taskId: CLOSED })}>
      Close the task
    </button>
  );
}

function renderCloser(result: TaskStatusWriteResult) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Closer result={result} />
      <Toaster />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.stopRepeat.mockReset();
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (name: string) =>
    name === 'tasks/queries:getTask'
      ? {
          task: {
            projectId: 'project-1',
            number: 8,
            title: 'Water the plants',
          },
          canEdit: true,
          canComment: true,
        }
      : { key: 'OPS' },
  );
});

describe('useNextTaskToast', () => {
  it('says nothing when the write created no next task', async () => {
    const { user } = renderCloser({});
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    expect(screen.queryByText('Next task created')).not.toBeInTheDocument();
  });

  it('announces the next task, with a way to stop the series', async () => {
    const { user } = renderCloser({ nextTask: NEXT });
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    expect(await screen.findByText('Next task created')).toBeInTheDocument();
    expect(screen.getByText(/^Due /)).toBeInTheDocument();
    // A screen reader hears where the action stays once the toast is gone.
    expect(
      screen.getByRole('button', { name: 'Stop repeating' }),
    ).toHaveAttribute(
      'data-radix-toast-announce-alt',
      'You can also stop the repeat later: open the task and choose "Stop repeating" under "Repeat".',
    );
  });

  it('stops the series from the closed task and says the next task went', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: true });
    const { user } = renderCloser({ nextTask: NEXT });
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    await user.click(
      await screen.findByRole('button', { name: 'Stop repeating' }),
    );
    expect(mocks.stopRepeat).toHaveBeenCalledOnce();
    // The next task's id rides along so its reads are held back while it
    // may be taken back.
    expect(mocks.stopRepeat).toHaveBeenCalledWith({
      taskId: CLOSED,
      nextTaskId: NEXT.id,
    });
    expect(await screen.findByText('Repeat stopped')).toBeInTheDocument();
    expect(screen.getByText('The next task was removed.')).toBeInTheDocument();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  // Someone already changed the next task: it stays, named by its
  // identifier, and only stops repeating.
  it('names a next task that was already changed and stays', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: false });
    const { user } = renderCloser({ nextTask: NEXT });
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    await user.click(
      await screen.findByRole('button', { name: 'Stop repeating' }),
    );
    expect(
      await screen.findByText(
        "OPS-8 was already changed, so it stays — it just won't repeat.",
      ),
    ).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith('tasks/queries:getTask', {
      organizationId: 'org-1',
      taskId: NEXT.id,
    });
  });

  it('still answers when the next task cannot be read', async () => {
    mocks.stopRepeat.mockResolvedValue({ removedNextTask: false });
    mocks.query.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { user } = renderCloser({ nextTask: NEXT });
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    await user.click(
      await screen.findByRole('button', { name: 'Stop repeating' }),
    );
    expect(
      await screen.findByText(
        "The next task was already changed, so it stays — it just won't repeat.",
      ),
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // The write's own error toast reports the failure; nothing claims success.
  it('claims nothing when the stop fails', async () => {
    mocks.stopRepeat.mockRejectedValue(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { user } = renderCloser({ nextTask: NEXT });
    await user.click(screen.getByRole('button', { name: 'Close the task' }));
    await user.click(
      await screen.findByRole('button', { name: 'Stop repeating' }),
    );
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByText('Repeat stopped')).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
