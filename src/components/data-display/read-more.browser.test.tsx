import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { ReadMore } from './read-more';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot measure: where the clamp
// cuts, that "almost long" content is left alone, that a narrower column
// re-measures, and that collapsing keeps the toggle on screen.
afterEach(cleanup);

beforeEach(async () => {
  await page.viewport(1024, 768);
});

/** `count` lines of `text-sm leading-6` prose: 24px each. */
function Lines({ count }: { count: number }) {
  return (
    <div className="text-sm leading-6">
      {Array.from({ length: count }, (_, i) => (
        <p key={i}>Line {i + 1}</p>
      ))}
    </div>
  );
}

function region(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[data-slot="read-more-content"]',
  );
  if (el === null) throw new Error('no read-more region');
  return el;
}

describe('ReadMore height mode (real layout)', () => {
  it('cuts long content at the limit and opens it to its full height', async () => {
    render(
      <div style={{ width: 480 }}>
        <ReadMore>
          <Lines count={40} />
        </ReadMore>
      </div>,
    );

    expect(region().getBoundingClientRect().height).toBe(320);
    expect(screen.getByText('Line 40')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(region().getBoundingClientRect().height).toBe(40 * 24);

    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(region().getBoundingClientRect().height).toBe(320);
  });

  it('shows content within the slack whole, with no toggle', () => {
    // 16 lines = 384px: longer than 320px, shorter than 320 + 96.
    render(
      <div style={{ width: 480 }}>
        <ReadMore>
          <Lines count={16} />
        </ReadMore>
      </div>,
    );

    expect(region().getBoundingClientRect().height).toBe(16 * 24);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('re-measures when its column narrows and the text wraps', async () => {
    const paragraph =
      'An agent wrote a report that wraps to many lines once the column gets narrow enough to matter. '.repeat(
        6,
      );
    render(
      <div data-testid="column" style={{ width: 900 }}>
        <ReadMore>
          <p className="text-sm leading-6">{paragraph}</p>
        </ReadMore>
      </div>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    screen.getByTestId('column').style.width = '120px';
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Read more' }))
      .not.toBeNull();
    expect(region().getBoundingClientRect().height).toBe(320);
  });

  it('keeps the toggle in view when a long block collapses', async () => {
    render(
      <div
        data-testid="scroller"
        style={{ height: 400, width: 480, overflowY: 'auto' }}
      >
        <ReadMore>
          <Lines count={120} />
        </ReadMore>
      </div>,
    );
    const scroller = screen.getByTestId('scroller');

    await userEvent.click(screen.getByRole('button', { name: 'Read more' }));
    // Read to the end, where the toggle now sits.
    scroller.scrollTop = scroller.scrollHeight;
    const less = screen.getByRole('button', { name: 'Show less' });
    await userEvent.click(less);

    const toggle = screen
      .getByRole('button', { name: 'Read more' })
      .getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    expect(toggle.top).toBeGreaterThanOrEqual(box.top);
    expect(toggle.bottom).toBeLessThanOrEqual(box.bottom);
  });

  it('gives the toggle a 24px target', () => {
    render(
      <ReadMore>
        <Lines count={40} />
      </ReadMore>,
    );
    const toggle = screen
      .getByRole('button', { name: 'Read more' })
      .getBoundingClientRect();
    expect(toggle.height).toBeGreaterThanOrEqual(24);
    expect(toggle.width).toBeGreaterThanOrEqual(24);
  });
});

describe('ReadMore lines mode (real layout)', () => {
  it('clamps a paragraph to the given lines through the content wrapper', () => {
    render(
      <div style={{ width: 240 }}>
        <ReadMore lines={3}>
          <p className="text-sm leading-6">
            {'Pack authors write whole handbooks into a description. '.repeat(
              8,
            )}
          </p>
        </ReadMore>
      </div>,
    );

    expect(region().getBoundingClientRect().height).toBe(3 * 24);
    expect(screen.getByRole('button', { name: 'Read more' })).toBeVisible();
  });

  it('offers no toggle when the text fits the lines', () => {
    render(
      <div style={{ width: 480 }}>
        <ReadMore lines={3}>
          <p className="text-sm leading-6">One short line.</p>
        </ReadMore>
      </div>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
