// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
} from '@tale/ui/responsive-dialog';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskDetailFallback } from './task-detail-fallback';

function renderIn(state: 'loading' | 'missing' | 'error', onClose = vi.fn()) {
  return render(
    <ResponsiveDialog open onOpenChange={vi.fn()}>
      <ResponsiveDialogContent closeLabel="Close dialog">
        <ResponsiveDialogDescription className="sr-only">
          Task
        </ResponsiveDialogDescription>
        <TaskDetailFallback state={state} onClose={onClose} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
}

// A deep link to a deleted task (`?task=<gone>`) used to open a large blank
// dialog titled "Tasks" — nothing said the task was gone.
describe('TaskDetailFallback', () => {
  it('says the task could not be found and offers Close', async () => {
    const onClose = vi.fn();
    const { user } = renderIn('missing', onClose);
    expect(
      screen.getByText("We couldn't find that task. It may have been deleted."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a busy skeleton, not the not-found copy, while loading', () => {
    renderIn('loading');
    expect(screen.queryByText(/couldn't find that task/)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('falls back to the generic failure for any other error', () => {
    renderIn('error');
    expect(screen.getByRole('status')).toHaveTextContent(
      /something went wrong/i,
    );
  });
});
