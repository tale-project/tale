import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskDialogHeaderActions } from './task-header-actions';

const state = vi.hoisted(() => ({
  task: { _id: 'task-1' } as { _id: string } | null,
  isLoading: false,
  copy: vi.fn(async () => true),
  built: [] as unknown[],
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useRouter: () => ({
    buildLocation: (options: unknown) => {
      state.built.push(options);
      return { href: '/dashboard/org-1/tasks/task-1' };
    },
  }),
}));
vi.mock('@tale/ui/use-copy', () => ({
  useCopy: () => ({ copy: state.copy }),
}));
vi.mock('../hooks/queries', () => ({
  useTask: () => ({ task: state.task, isLoading: state.isLoading }),
}));

describe('TaskDialogHeaderActions', () => {
  it('offers the task page as a link and its address to copy', async () => {
    state.task = { _id: 'task-1' };
    const { user } = render(
      <TaskDialogHeaderActions organizationId="org-1" taskId="task-1" />,
    );
    expect(
      screen.getByRole('link', { name: 'Open as page' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(state.built.at(-1)).toEqual({
      to: '/dashboard/$id/tasks/$taskId',
      params: { id: 'org-1', taskId: 'task-1' },
    });
    expect(state.copy).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard/org-1/tasks/task-1`,
    );
  });

  it('shows nothing for a task that does not exist', () => {
    state.task = null;
    state.isLoading = false;
    render(<TaskDialogHeaderActions organizationId="org-1" taskId="gone" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps its actions while the task is still loading', () => {
    state.task = null;
    state.isLoading = true;
    render(<TaskDialogHeaderActions organizationId="org-1" taskId="task-1" />);
    expect(
      screen.getByRole('link', { name: 'Open as page' }),
    ).toBeInTheDocument();
  });
});
