// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
} from '@tale/ui/responsive-dialog';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { render, screen } from '@/tests/utils/render';

import { TaskDetailFallback } from './task-detail-fallback';

function renderInDialog(fallback: ReactElement) {
  return render(
    <ResponsiveDialog open onOpenChange={vi.fn()}>
      <ResponsiveDialogContent closeLabel="Close dialog">
        <ResponsiveDialogDescription className="sr-only">
          Task
        </ResponsiveDialogDescription>
        {fallback}
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
}

/** What `fetch` rejects with when a request gets no answer. */
const offline = () => new TypeError('Failed to fetch');

// A deep link to a deleted task (`?task=<gone>`) used to open a large blank
// dialog titled "Tasks" — nothing said the task was gone.
describe('TaskDetailFallback', () => {
  it('says the task could not be found and offers Close', async () => {
    const onClose = vi.fn();
    const { user } = renderInDialog(
      <TaskDetailFallback state="missing" onClose={onClose} />,
    );
    expect(
      screen.getByText("We couldn't find that task. It may have been deleted."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a busy skeleton, not the not-found copy, while loading', () => {
    renderInDialog(<TaskDetailFallback state="loading" onClose={vi.fn()} />);
    expect(screen.queryByText(/couldn't find that task/)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  // #4587: a failed read is not a task that is gone, and it can be read again.
  it('says the read failed, with its reason, Try again and Close', async () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    const { user } = renderInDialog(
      <TaskDetailFallback
        state="error"
        error={offline()}
        retrying={false}
        onRetry={onRetry}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this task. Couldn't reach Tale. Check your connection and try again.",
    );
    expect(screen.queryByText(/couldn't find that task/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('names no detail of a server fault, only that the read failed', () => {
    renderInDialog(
      <TaskDetailFallback
        state="error"
        error={new BackendApiError(503, '{"secret":"payload"}')}
        retrying={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this task.");
    expect(alert).not.toHaveTextContent(/secret|payload|503/);
  });

  it('keeps Try again busy, and does not read twice, while a retry runs', async () => {
    const onRetry = vi.fn();
    const { user } = renderInDialog(
      <TaskDetailFallback
        state="error"
        error={offline()}
        retrying
        onRetry={onRetry}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Trying again…');
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    expect(tryAgain).toHaveAttribute('aria-busy', 'true');
    await user.click(tryAgain);
    expect(onRetry).not.toHaveBeenCalled();
  });

  // The task page has no dialog around it: its title is the page heading,
  // and the person stays on the page, so there is nothing to close.
  it('gives the task page a heading of its own, outside any dialog', async () => {
    const onRetry = vi.fn();
    const { user } = render(
      <TaskDetailFallback
        surface="page"
        state="error"
        error={offline()}
        retrying={false}
        onRetry={onRetry}
        onFocusLost={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tasks' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load this task.",
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
