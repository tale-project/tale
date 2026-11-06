import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useFocusHandoff } from './use-focus-handoff';

/** A host that stays while its action gives way to a status, as a notice
 * does once its action worked. */
function Notice({ onFocusLost }: { onFocusLost: () => void }) {
  const [done, setDone] = useState(false);
  const actionRef = useFocusHandoff<HTMLDivElement>(onFocusLost);
  return (
    <div>
      <button type="button">Elsewhere</button>
      {done ? (
        <p>Done.</p>
      ) : (
        <div ref={actionRef}>
          <button type="button" onClick={() => setDone(true)}>
            Act
          </button>
        </div>
      )}
    </div>
  );
}

/** A host that leaves with the element, as an error state does when a
 * retry's answer replaces it. */
function RetryRow({ onFocusLost }: { onFocusLost: () => void }) {
  const ref = useFocusHandoff<HTMLSpanElement>(onFocusLost);
  return (
    <span ref={ref}>
      <button type="button">Try again</button>
    </span>
  );
}

describe('useFocusHandoff', () => {
  it('hands focus on when the element alone leaves while focused', async () => {
    const onFocusLost = vi.fn();
    render(<Notice onFocusLost={onFocusLost} />);
    const act_ = screen.getByRole('button', { name: 'Act' });
    act_.focus();
    act(() => act_.click());
    expect(screen.getByText('Done.')).toBeVisible();
    await waitFor(() => expect(onFocusLost).toHaveBeenCalledTimes(1));
  });

  it('hands focus on when its whole host leaves while focused', async () => {
    const onFocusLost = vi.fn();
    const { rerender } = render(<RetryRow onFocusLost={onFocusLost} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    rerender(<p>Loaded.</p>);
    await waitFor(() => expect(onFocusLost).toHaveBeenCalledTimes(1));
  });

  it('leaves the focus alone when it was not inside', async () => {
    const onFocusLost = vi.fn();
    render(<Notice onFocusLost={onFocusLost} />);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    act(() => screen.getByRole('button', { name: 'Act' }).click());
    // A frame passes, and nothing is handed on.
    await act(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
    );
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('calls the latest callback the host passed', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<RetryRow onFocusLost={first} />);
    rerender(<RetryRow onFocusLost={latest} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    rerender(<p>Loaded.</p>);
    await waitFor(() => expect(latest).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });
});
