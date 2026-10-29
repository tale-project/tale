import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, fireEvent, render, screen } from '@/tests/utils/render';

import { AccessRefreshNotice } from './access-refresh-notice';

/** The shell around the notice: its page region takes the focus it hands on. */
function Shell({
  failed,
  retrying = false,
  failureKey = 1,
  onRetry = vi.fn(),
}: {
  failed: boolean;
  retrying?: boolean;
  failureKey?: number;
  onRetry?: () => void;
}) {
  return (
    <>
      {failed && (
        <AccessRefreshNotice
          retrying={retrying}
          onRetry={onRetry}
          failureKey={failureKey}
          onFocusLost={() => document.getElementById('page')?.focus()}
        />
      )}
      <main id="page" aria-label="Page" tabIndex={-1} />
    </>
  );
}

describe('AccessRefreshNotice', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says the refresh failed and asks again on Try again', async () => {
    const onRetry = vi.fn();
    const { container } = render(<Shell failed onRetry={onRetry} />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent("Couldn't refresh your access");
    expect(notice).toHaveTextContent(
      'What you see follows your role as it was last loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await checkAccessibility(container);
  });

  it('keeps Try again focusable but busy while the retry runs', () => {
    const onRetry = vi.fn();
    render(<Shell failed retrying onRetry={onRetry} />);

    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).not.toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('writes the title afresh for each failure and keeps Try again', () => {
    const view = render(<Shell failed failureKey={1} />);
    const title = screen.getByText("Couldn't refresh your access");
    const retry = screen.getByRole('button', { name: 'Try again' });

    view.rerender(<Shell failed failureKey={2} />);

    expect(title.isConnected).toBe(false);
    expect(screen.getByText("Couldn't refresh your access")).not.toBe(title);
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
  });

  it('hands the focus on Try again to the page when an answer takes it away', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => frames.push(callback),
    );
    const view = render(<Shell failed />);
    screen.getByRole('button', { name: 'Try again' }).focus();

    view.rerender(<Shell failed={false} />);
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });

    expect(screen.getByRole('main', { name: 'Page' })).toHaveFocus();
  });
});
