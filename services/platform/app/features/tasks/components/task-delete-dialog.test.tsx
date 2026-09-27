import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { TaskDeleteDialog } from './task-delete-dialog';

const deleteMutate = vi.fn();
const toast = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useDeleteTask: () => ({ mutateAsync: deleteMutate }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

beforeEach(() => {
  deleteMutate.mockReset();
  toast.mockReset();
});

describe('TaskDeleteDialog', () => {
  it('deletes the task, closes, and calls onDeleted', async () => {
    deleteMutate.mockResolvedValue({ deletedChildCount: 2 });
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();

    render(
      <TaskDeleteDialog
        open
        onOpenChange={onOpenChange}
        taskId="task123"
        taskTitle="Onboarding"
        onDeleted={onDeleted}
      />,
    );

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'actions.delete' }),
    );

    expect(deleteMutate).toHaveBeenCalledWith({ taskId: 'task123' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'delete.success', variant: 'success' }),
    );
  });

  it('keeps the dialog open and names the refusal when the backend refuses', async () => {
    deleteMutate.mockRejectedValue(
      new AppError({ code: 'ROLE_FORBIDDEN', message: 'Admin role required' }),
    );
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();

    render(
      <TaskDeleteDialog
        open
        onOpenChange={onOpenChange}
        taskId="task123"
        taskTitle="Onboarding"
        onDeleted={onDeleted}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'actions.delete' }),
    );

    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'delete.error',
        variant: 'destructive',
      }),
    );
  });
});
