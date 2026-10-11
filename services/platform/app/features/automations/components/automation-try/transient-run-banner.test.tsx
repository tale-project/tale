import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TransientRunBanner } from './transient-run-banner';

const AT = Date.UTC(2026, 9, 11, 15, 42);

describe('TransientRunBanner', () => {
  it('says which run lies over the canvas and how it ended, with the way back', async () => {
    const onTryAgain = vi.fn();
    const onClear = vi.fn();
    const { user } = render(
      <TransientRunBanner
        title="Unsaved test"
        state={{
          kind: 'done',
          status: 'failed',
          words: 'Failed at Score',
          at: AT,
        }}
        onTryAgain={onTryAgain}
        onClear={onClear}
      />,
    );
    const banner = screen.getByRole('region', { name: 'Unsaved test' });
    // The status is a polite live region that names the run too.
    expect(screen.getByRole('status')).toHaveTextContent(
      /Unsaved test: Failed at Score/,
    );
    expect(banner).not.toHaveTextContent('The draft changed');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Hide result' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('holds Try again while the run goes, and says what changed since it ran', () => {
    const { rerender } = render(
      <TransientRunBanner
        title="Unsaved test"
        state={{ kind: 'running', words: 'Trying the draft…' }}
        onTryAgain={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Trying the draft…');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    rerender(
      <TransientRunBanner
        title="Test: Big order"
        state={{
          kind: 'done',
          status: 'success',
          words: 'Succeeded in 12 ms',
          at: AT,
        }}
        changed="The draft changed since this try."
        note="Its condition is false with this data; the test ran it anyway."
        onTryAgain={() => {}}
        againLabel="Run"
        onClear={() => {}}
      />,
    );
    expect(
      screen.getByText(
        'Its condition is false with this data; the test ran it anyway.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The draft changed since this try.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('offers no Try again when the run cannot be run again', () => {
    render(
      <TransientRunBanner
        title="Test: Big order"
        state={{
          kind: 'done',
          status: 'cancelled',
          words: 'Stopped after 10 s — a try has a time limit.',
          at: AT,
        }}
        onClear={() => {}}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide result' }),
    ).toBeInTheDocument();
  });
});
