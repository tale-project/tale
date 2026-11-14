import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen } from '@/tests/utils/render';

import { useFocusHandoff } from './use-focus-handoff';

function Failure({ onFocusLost }: { onFocusLost: () => void }) {
  const ref = useFocusHandoff<HTMLDivElement>(onFocusLost);
  return (
    <div ref={ref}>
      <button type="button">Try again</button>
    </div>
  );
}

function Pane({
  show,
  onFocusLost,
}: {
  show: boolean;
  onFocusLost: () => void;
}) {
  return (
    <div data-testid="ancestor" tabIndex={-1}>
      <section aria-label="Recovered list" tabIndex={-1} />
      <button type="button">Elsewhere</button>
      {show && <Failure onFocusLost={onFocusLost} />}
    </div>
  );
}

function DialogPane({
  show,
  onFocusLost,
}: {
  show: boolean;
  onFocusLost: () => void;
}) {
  return (
    <div role="dialog" tabIndex={-1}>
      <section aria-label="Recovered list" tabIndex={-1} />
      <button type="button">Elsewhere</button>
      {show && <Failure onFocusLost={onFocusLost} />}
    </div>
  );
}

describe('useFocusHandoff frame-time ownership', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
    );
  });

  afterEach(() => vi.restoreAllMocks());

  function removeFocusedRetry(onFocusLost: () => void) {
    const view = render(<Pane show onFocusLost={onFocusLost} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    expect(retry).toHaveFocus();
    view.rerender(<Pane show={false} onFocusLost={onFocusLost} />);
    expect(retry.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(frames).toHaveLength(1);
    return view;
  }

  function runFrame() {
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
  }

  it('hands actual BODY fallback to the mounted named region after the frame', () => {
    const handoff = vi.fn(() =>
      screen.getByRole('region', { name: 'Recovered list' }).focus(),
    );
    removeFocusedRetry(handoff);
    expect(handoff).not.toHaveBeenCalled();

    runFrame();

    expect(handoff).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('region', { name: 'Recovered list' }),
    ).toHaveFocus();
  });

  it.each(['foreign control', 'ancestor', 'already restored target'] as const)(
    'preserves connected focus on the %s chosen before the queued frame',
    (destination) => {
      const handoff = vi.fn();
      removeFocusedRetry(handoff);
      const target =
        destination === 'foreign control'
          ? screen.getByRole('button', { name: 'Elsewhere' })
          : destination === 'ancestor'
            ? screen.getByTestId('ancestor')
            : screen.getByRole('region', { name: 'Recovered list' });
      target.focus();
      expect(target).toHaveFocus();
      expect(target.isConnected).toBe(true);

      runFrame();

      expect(handoff).not.toHaveBeenCalled();
      expect(target).toHaveFocus();
    },
  );

  it('hands off when a dialog focus trap parks focus on its root', () => {
    const handoff = vi.fn();
    const view = render(<DialogPane show onFocusLost={handoff} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    view.rerender(<DialogPane show={false} onFocusLost={handoff} />);
    expect(frames).toHaveLength(1);

    const dialog = screen.getByRole('dialog');
    dialog.focus();
    runFrame();

    expect(handoff).toHaveBeenCalledTimes(1);
  });

  it('preserves focus when the reader chooses another dialog control', () => {
    const handoff = vi.fn();
    const view = render(<DialogPane show onFocusLost={handoff} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    view.rerender(<DialogPane show={false} onFocusLost={handoff} />);
    const destination = screen.getByRole('button', { name: 'Elsewhere' });
    destination.focus();

    runFrame();

    expect(handoff).not.toHaveBeenCalled();
    expect(destination).toHaveFocus();
  });

  it('does not queue a handoff when the member left before removal', () => {
    const handoff = vi.fn();
    const view = render(<Pane show onFocusLost={handoff} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    const target = screen.getByRole('button', { name: 'Elsewhere' });
    target.focus();

    view.rerender(<Pane show={false} onFocusLost={handoff} />);
    expect(frames).toHaveLength(0);
    runFrame();

    expect(handoff).not.toHaveBeenCalled();
    expect(target).toHaveFocus();
  });

  it('uses the latest committed callback without treating a callback change as removal', () => {
    const initial = vi.fn();
    const latest = vi.fn();
    const view = render(<Pane show onFocusLost={initial} />);
    screen.getByRole('button', { name: 'Try again' }).focus();
    view.rerender(<Pane show onFocusLost={latest} />);
    expect(frames).toHaveLength(0);
    view.rerender(<Pane show={false} onFocusLost={latest} />);
    expect(frames).toHaveLength(1);

    runFrame();

    expect(initial).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
