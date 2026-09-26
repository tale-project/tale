import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { TaskDetailPage } from './task-detail-page';

const read = vi.hoisted(() => ({
  current: { task: null, isLoading: true } as {
    task: { projectId: string } | null;
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
}));

vi.mock('../hooks/queries', () => ({
  useTask: () => read.current,
}));

// The body is the board dialog's own, tested with it; here it only has to
// show whether the page mounted it.
vi.mock('./task-modal', () => ({
  EditTaskBody: () => <div data-testid="task-body" />,
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
