/**
 * The Try again recovery rule (PR #3894 review): focus returns to the new
 * control only when removing the old one stranded it. A member who put focus
 * somewhere while the retry ran keeps it there, and a failure they did not
 * retry never moves it.
 */

import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { useRetryFocus } from './use-retry-focus';

type Status = 'loading' | 'failed' | 'ready';

/** A pane whose Try again unmounts while its read is retried. `trap` is a
 * focusable container around it, where a dialog's focus trap parks focus. */
function Pane({ status, readKey }: { status: Status; readKey?: string }) {
  const retryFocus = useRetryFocus(status, readKey);
  return (
    <div data-testid="trap" tabIndex={-1}>
      <button type="button">Tree row</button>
      {status === 'failed' ? (
        <div ref={retryFocus.ref}>
          <button type="button" onClick={retryFocus.arm}>
            Try again
          </button>
        </div>
      ) : (
        <p>{status}</p>
      )}
    </div>
  );
}

const tryAgain = () => screen.getByRole('button', { name: 'Try again' });

/** Press Try again, then show the retry under its loading mask. */
async function retry(
  view: ReturnType<typeof render>,
  readKey?: string,
): Promise<void> {
  tryAgain().focus();
  await view.user.keyboard('{Enter}');
  view.rerender(<Pane status="loading" readKey={readKey} />);
}

describe('useRetryFocus', () => {
  it('puts focus on the new Try again when the removed one stranded it', async () => {
    const view = render(<Pane status="failed" />);
    await retry(view);
    expect(document.activeElement).toBe(document.body);

    view.rerender(<Pane status="failed" />);

    expect(tryAgain()).toHaveFocus();
  });

  it('treats focus a focus trap parked on a container as stranded', async () => {
    const view = render(<Pane status="failed" />);
    await retry(view);
    screen.getByTestId('trap').focus();

    view.rerender(<Pane status="failed" />);

    expect(tryAgain()).toHaveFocus();
  });

  it('leaves focus on a control the member moved to while the retry ran', async () => {
    const view = render(<Pane status="failed" />);
    await retry(view);
    const row = screen.getByRole('button', { name: 'Tree row' });
    row.focus();

    view.rerender(<Pane status="failed" />);

    expect(row).toHaveFocus();
    expect(row).toBeInTheDocument();
  });

  it('does not move focus for a failure after an answer', async () => {
    const view = render(<Pane status="failed" />);
    await retry(view);
    view.rerender(<Pane status="ready" />);

    view.rerender(<Pane status="failed" />);

    expect(tryAgain()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not move focus for the failure of another read', async () => {
    const view = render(<Pane status="failed" readKey="a.txt" />);
    await retry(view, 'a.txt');

    // The member moved on to another file, whose own first read fails.
    view.rerender(<Pane status="loading" readKey="b.txt" />);
    view.rerender(<Pane status="failed" readKey="b.txt" />);

    expect(tryAgain()).not.toHaveFocus();
  });

  it('stays disarmed when focus was not on Try again at the press', () => {
    const view = render(<Pane status="failed" />);
    // A pointer press that leaves focus where it was (Safari does not focus
    // a clicked button).
    const row = screen.getByRole('button', { name: 'Tree row' });
    row.focus();
    tryAgain().click();
    view.rerender(<Pane status="loading" />);
    row.blur();

    view.rerender(<Pane status="failed" />);

    expect(tryAgain()).not.toHaveFocus();
  });
});
