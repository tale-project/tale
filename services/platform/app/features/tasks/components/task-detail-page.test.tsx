import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enMessages } from '@/tests/utils/messages';
import { render, screen, waitFor } from '@/tests/utils/render';

import { TaskDetailPage } from './task-detail-page';

interface TaskRead {
  task: { projectId: string; title?: string } | null;
  isLoading: boolean;
  notFound: boolean;
  error: unknown;
  retrying: boolean;
  retry: () => void;
}

const read = vi.hoisted(() => ({ current: {} as TaskRead }));

/** `useTask` as it answers: still on its way, unless a test says otherwise. */
function taskRead(overrides: Partial<TaskRead> = {}): TaskRead {
  return {
    task: null,
    isLoading: true,
    notFound: false,
    error: null,
    retrying: false,
    retry: vi.fn(),
    ...overrides,
  };
}

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
  read.current = taskRead();
});

describe('TaskDetailPage', () => {
  it('shows the dead end with its way out when the task is gone', () => {
    read.current = taskRead({ isLoading: false, notFound: true });
    render(<TaskDetailPage organizationId="org-1" taskId="t-gone" />);

    expect(
      screen.getByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard/org-1');
    expect(screen.queryByTestId('task-body')).toBeNull();
  });

  // #4587: a read that failed for any other reason (offline, a server
  // fault) said the task did not exist, with no way to read it again.
  it('says a failed read failed, with Try again, never Page not found', async () => {
    const retry = vi.fn();
    read.current = taskRead({
      isLoading: false,
      error: new TypeError('Failed to fetch'),
      retry,
    });
    const { user } = render(
      <TaskDetailPage organizationId="org-1" taskId="t1" />,
    );

    expect(
      screen.queryByRole('heading', { name: notFound.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: notFound.backToDashboard }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      `${enMessages.tasks.detail.loadFailed} ${enMessages.common.errors.connectionLost}`,
    );
    expect(screen.queryByTestId('task-body')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the failure on the page while Try again runs', () => {
    read.current = taskRead({
      isLoading: true,
      error: new TypeError('Failed to fetch'),
      retrying: true,
    });
    render(<TaskDetailPage organizationId="org-1" taskId="t1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      enMessages.tasks.read.retrying,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByTestId('task-body')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: notFound.title }),
    ).not.toBeInTheDocument();
  });

  it('hands the focus to the task a retry brought back', async () => {
    read.current = taskRead({
      isLoading: false,
      error: new TypeError('Failed to fetch'),
    });
    const { user, rerender } = render(
      <TaskDetailPage organizationId="org-1" taskId="t1" />,
    );
    const tryAgain = screen.getByRole('button', {
      name: 'Try again',
    });
    await user.click(tryAgain);
    expect(tryAgain).toHaveFocus();

    read.current = taskRead({
      task: { projectId: 'p1', title: 'Review the launch checklist' },
      isLoading: false,
    });
    rerender(<TaskDetailPage organizationId="org-1" taskId="t1" />);

    expect(screen.getByTestId('task-body')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Review the launch checklist' }),
      ).toHaveFocus(),
    );
  });

  it('copies the task page link, without its query', async () => {
    read.current = taskRead({ task: { projectId: 'p1' }, isLoading: false });
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
    read.current = taskRead({
      task: { projectId: 'p1', title: 'Review the launch checklist' },
      isLoading: false,
    });
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

    read.current = taskRead({ task: { projectId: 'p1' }, isLoading: false });
    rerender(<TaskDetailPage organizationId="org-1" taskId="t1" />);
    expect(screen.getByTestId('task-body')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: notFound.title }),
    ).not.toBeInTheDocument();
  });
});
