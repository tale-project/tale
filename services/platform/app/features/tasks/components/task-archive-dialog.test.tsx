import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TaskArchiveDialog } from './task-archive-dialog';

const archiveMutate = vi.fn();
const restoreMutate = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useArchiveTask: () => ({ mutateAsync: archiveMutate }),
  useRestoreTask: () => ({ mutateAsync: restoreMutate }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

describe('TaskArchiveDialog', () => {
  it('archives a task and calls onArchived', async () => {
    archiveMutate.mockResolvedValue(undefined);
    const onArchived = vi.fn();

    render(
      <TaskArchiveDialog
        open
        onOpenChange={vi.fn()}
        taskId={'task123' as never}
        taskTitle="Onboarding"
        isArchived={false}
        onArchived={onArchived}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'actions.archive' }),
    );

    expect(archiveMutate).toHaveBeenCalledWith({ taskId: 'task123' });
    expect(onArchived).toHaveBeenCalledOnce();
    expect(restoreMutate).not.toHaveBeenCalled();
  });

  it('restores an archived task without onArchived', async () => {
    restoreMutate.mockResolvedValue(undefined);
    const onArchived = vi.fn();

    render(
      <TaskArchiveDialog
        open
        onOpenChange={vi.fn()}
        taskId={'task123' as never}
        taskTitle="Onboarding"
        isArchived
        onArchived={onArchived}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'actions.restore' }),
    );

    expect(restoreMutate).toHaveBeenCalledWith({ taskId: 'task123' });
    expect(onArchived).not.toHaveBeenCalled();
  });
});
