import { Avatar } from '@tale/ui/avatar';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { THREAD_COLUMN_CLASS } from './layout';
import { ThreadMessage } from './thread-message';

import '../../globals.css';

// Real-Chromium coverage for the bubble's width, which answers to the
// conversation's column (a container query) rather than to the window, and
// for the indent that lines another voice's body up under its name.
afterEach(cleanup);

beforeEach(async () => {
  await page.viewport(1280, 800);
});

const LONG =
  'A message long enough to reach the bubble’s widest point, whatever the column, so its width is the cap and not its text. '.repeat(
    4,
  );

function renderOwn(width: number) {
  render(
    <div className="@container" style={{ width }}>
      <div className="flex flex-col">
        <ThreadMessage variant="own">
          <span>{LONG}</span>
        </ThreadMessage>
      </div>
    </div>,
  );
  const bubble = document.querySelector<HTMLElement>(
    '[data-slot="thread-message-body"]',
  );
  if (bubble === null) throw new Error('no bubble');
  return bubble.getBoundingClientRect();
}

describe('ThreadMessage own bubble width (real layout)', () => {
  it('takes up to 85% of a narrow column', () => {
    const bubble = renderOwn(400);
    expect(bubble.width).toBeCloseTo(400 * 0.85, 0);
    // Right-aligned: its end meets the column's end.
    expect(bubble.right).toBeCloseTo(
      screen
        .getByText(/A message long/)
        .closest('.\\@container')!
        .getBoundingClientRect().right,
      0,
    );
  });

  it('takes up to 75% once the column is 28rem wide, whatever the window', () => {
    const bubble = renderOwn(720);
    expect(bubble.width).toBeCloseTo(720 * 0.75, 0);
  });

  it('hugs a short message', () => {
    render(
      <div className="@container" style={{ width: 720 }}>
        <ThreadMessage variant="own">Thanks!</ThreadMessage>
      </div>,
    );
    const bubble = document
      .querySelector<HTMLElement>('[data-slot="thread-message-body"]')!
      .getBoundingClientRect();
    expect(bubble.width).toBeLessThan(120);
  });
});

describe('ThreadMessage other voice (real layout)', () => {
  it('lines the body up under the name, past the 24px avatar', () => {
    render(
      <div className={THREAD_COLUMN_CLASS} style={{ width: 600 }}>
        <ThreadMessage
          avatar={<Avatar name="Yara Polish" label="Yara Polish" />}
          author="Yara Polish"
          time="14:32"
        >
          <span>Looks great.</span>
        </ThreadMessage>
      </div>,
    );
    const avatar = screen
      .getByRole('img', { name: 'Yara Polish' })
      .getBoundingClientRect();
    const name = screen.getByText('Yara Polish').getBoundingClientRect();
    const body = screen.getByText('Looks great.').getBoundingClientRect();

    expect(avatar.width).toBe(24);
    expect(body.left).toBe(name.left);
    expect(name.left - avatar.left).toBe(32);
  });
});
