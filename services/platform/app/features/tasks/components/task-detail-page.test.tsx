import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enMessages } from '@/tests/utils/messages';
import { render, screen } from '@/tests/utils/render';

import { TaskDetailPage } from './task-detail-page';

const read = vi.hoisted(() => ({
  current: { task: null, isLoading: true } as {
    task: { projectId: string; title?: string } | null;
    isLoading: boolean;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    href?: string;
  }) => <a href={props.to ?? props.href}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    buildLocation: ({
      params,
    }: {
      params: { id: string; taskId: string };
    }) => ({
      href: `/dashboard/${params.id}/tasks/${params.taskId}`,
    }),
  }),
}));

vi.mock('../hooks/queries', () => ({
  useTask: () => read.current,
}));

// The body is the board dialog's own, tested with it; here it only has to
// show whether the page mounted it, and carry the page's own verbs.
vi.mock('./task-modal', () => ({
  EditTaskBody: ({ pageActions }: { pageActions?: React.ReactNode }) => (
    <div data-testid="task-body">{pageActions}</div>
  ),
}));

const clipboard = vi.hoisted(() => ({
  copy: vi.fn((_value: string) => Promise.resolve(true)),
}));
vi.mock('@tale/ui/use-copy', () => ({
  useCopy: () => ({ copied: false, copy: clipboard.copy, reset: vi.fn() }),
}));

const notFound = enMessages.common.notFound;

beforeEach(() => {
  read.current = { task: null, isLoading: true };
});

describe('TaskDetailPage', () => {
  it('shows the dead end with its way out when the task is gone', () => {
    read.current = { task: null, isLoading: false };
    render(<TaskDetailPage organizationId="org-1" taskId="t-gone" />);

    expect(
      screen.getByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard/org-1');
    expect(screen.queryByTestId('task-body')).toBeNull();
  });

  it('copies the task page link, without its query', async () => {
    read.current = { task: { projectId: 'p1' }, isLoading: false };
    window.history.pushState({}, '', '/dashboard/org-1/tasks/t1?from=search');
    const { user } = render(
      <TaskDetailPage organizationId="org-1" taskId="t1" />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(clipboard.copy).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard/org-1/tasks/t1`,
    );
  });

  it('names the browser tab after the task', () => {
    read.current = {
      task: { projectId: 'p1', title: 'Review the launch checklist' },
      isLoading: false,
    };
    const { unmount } = render(
      <TaskDetailPage organizationId="org-1" taskId="t1" />,
    );
    expect(document.title).toMatch(/^Review the launch checklist - /);

    unmount();
    expect(document.title).not.toMatch(/^Review the launch checklist/);
  });

  it('mounts the task body while the task loads and once it arrives', () => {
    const { rerender } = render(
      <TaskDetailPage organizationId="org-1" taskId="t1" />,
    );
    expect(screen.getByTestId('task-body')).toBeInTheDocument();

    read.current = { task: { projectId: 'p1' }, isLoading: false };
    rerender(<TaskDetailPage organizationId="org-1" taskId="t1" />);
    expect(screen.getByTestId('task-body')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: notFound.title }),
    ).not.toBeInTheDocument();
  });
});
