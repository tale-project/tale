import '@testing-library/jest-dom/vitest';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { HELD_SCROLLPORTS } from '../hooks/use-task-history-anchor';
import { TaskThreadColumn } from './task-thread-column';

import '@/app/globals.css';

// Real-Chromium coverage for the column the task page and the board's dialog
// share: where it opens, that it stays on its newest end while the thread or
// its own box changes, that the composer stays in view, and that a wheel or a
// trackpad scrolls it wherever it is hosted.
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Thread({ rows }: { rows: number }) {
  return (
    <ol>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="h-16">
          Comment {index + 1}
        </li>
      ))}
    </ol>
  );
}

/** A thread that grows by five comments, and a composer that grows to six
 *  times its height, on the buttons above the column. */
function Growing({ rows }: { rows: number }) {
  const [count, setCount] = useState(rows);
  const [composerHeight, setComposerHeight] = useState(40);
  return (
    <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
      <div>
        <button onClick={() => setCount((current) => current + 5)}>
          Add comments
        </button>
        <button onClick={() => setComposerHeight(240)}>Grow composer</button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <TaskThreadColumn
          brief={<p>The brief</p>}
          conversation={<Thread rows={count} />}
          composer={
            <textarea aria-label="Comment" style={{ height: composerHeight }} />
          }
        />
      </div>
    </div>
  );
}

function scrollport() {
  return screen.getByTestId('task-thread-scrollport');
}

function renderColumn(rows: number) {
  render(
    <div style={{ height: 480, display: 'flex' }}>
      <TaskThreadColumn
        brief={<p>The brief</p>}
        conversation={<Thread rows={rows} />}
        composer={<textarea aria-label="Comment" />}
      />
    </div>,
  );
  return scrollport();
}

function inView(element: HTMLElement, scroller: HTMLElement) {
  const box = element.getBoundingClientRect();
  const port = scroller.getBoundingClientRect();
  return box.bottom > port.top && box.top < port.bottom;
}

/** A reader's wheel: far enough in one direction to reach that end. */
async function wheelToTop(over: HTMLElement) {
  await userEvent.wheel(over, { delta: { y: -10_000 } });
  await waitFor(() =>
    expect(inView(screen.getByText('The brief'), scrollport())).toBe(true),
  );
}

async function wheelToEnd(over: HTMLElement, last: string) {
  await userEvent.wheel(over, { delta: { y: 10_000 } });
  await waitFor(() =>
    expect(inView(screen.getByText(last), scrollport())).toBe(true),
  );
}

describe('TaskThreadColumn (real layout)', () => {
  it('opens a long thread at its newest end, the brief one scroll up', () => {
    const scroller = renderColumn(40);

    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    expect(inView(screen.getByText('Comment 40'), scroller)).toBe(true);
    expect(inView(screen.getByText('The brief'), scroller)).toBe(false);
  });

  it('starts a short thread at the top, brief first', () => {
    const scroller = renderColumn(2);

    const brief = screen.getByText('The brief').getBoundingClientRect();
    expect(brief.top - scroller.getBoundingClientRect().top).toBeLessThan(80);
    expect(inView(screen.getByText('Comment 2'), scroller)).toBe(true);
  });

  it('keeps the composer under the thread while the thread scrolls', async () => {
    const scroller = renderColumn(40);
    const composer = screen.getByRole('textbox', { name: 'Comment' });
    const before = composer.getBoundingClientRect().top;

    await wheelToTop(screen.getByText('Comment 40'));

    expect(composer.getBoundingClientRect().top).toBe(before);
    expect(composer.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    );
  });
});

describe('TaskThreadColumn on its newest end', () => {
  it('stays on it while the thread grows', async () => {
    render(<Growing rows={40} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add comments' }));

    await waitFor(() =>
      expect(inView(screen.getByText('Comment 45'), scrollport())).toBe(true),
    );
  });

  it('stays on it while the composer grows and the column shrinks', async () => {
    render(<Growing rows={40} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Grow composer' }),
    );

    await waitFor(() =>
      expect(inView(screen.getByText('Comment 40'), scrollport())).toBe(true),
    );
  });

  it('leaves a reader who scrolled up where they are while the thread grows', async () => {
    render(<Growing rows={40} />);
    await wheelToTop(screen.getByText('Comment 40'));
    const brief = screen.getByText('The brief');
    const before = brief.getBoundingClientRect().top;

    await userEvent.click(screen.getByRole('button', { name: 'Add comments' }));
    await screen.findByText('Comment 45');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(brief.getBoundingClientRect().top).toBeCloseTo(before, 0);
    expect(inView(screen.getByText('Comment 45'), scrollport())).toBe(false);
  });

  it('follows the thread again once the reader is back at its end', async () => {
    render(<Growing rows={40} />);
    await wheelToTop(screen.getByText('Comment 40'));
    await wheelToEnd(screen.getByText('The brief'), 'Comment 40');

    await userEvent.click(screen.getByRole('button', { name: 'Add comments' }));

    await waitFor(() =>
      expect(inView(screen.getByText('Comment 45'), scrollport())).toBe(true),
    );
  });
});

/** History rows like the conversation's, one of them above the reader
 *  growing by 200px on the button: a row drawn at its real height. */
function Shifting({ scrollerClassName }: { scrollerClassName?: string }) {
  const [grown, setGrown] = useState(false);
  return (
    <div style={{ height: 480, display: 'flex', flexDirection: 'column' }}>
      <button onClick={() => setGrown(true)}>Grow an earlier comment</button>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <TaskThreadColumn
          brief={<p>The brief</p>}
          conversation={
            <ol>
              {Array.from({ length: 40 }, (_, index) => (
                <li
                  key={index}
                  data-task-history-entry
                  style={{ height: index === 3 && grown ? 264 : 64 }}
                >
                  Comment {index + 1}
                </li>
              ))}
            </ol>
          }
          composer={<textarea aria-label="Comment" />}
          {...(scrollerClassName === undefined ? {} : { scrollerClassName })}
        />
      </div>
    </div>
  );
}

/** A browser that has no scroll anchoring answers the support question no, and
 *  its scrollport anchors nothing. */
function renderLikeSafari() {
  const supports = CSS.supports.bind(CSS);
  vi.spyOn(CSS, 'supports').mockImplementation(
    (property: string, value?: string) => {
      if (property.includes('overflow-anchor')) return false;
      return value === undefined
        ? supports(property)
        : supports(property, value);
    },
  );
  render(<Shifting scrollerClassName="[overflow-anchor:none]" />);
}

/** Scrolls a reader up to Comment 20, grows Comment 4 above it by 200px, and
 *  returns how far Comment 20 moved on the screen. */
async function growAboveTheReader() {
  await userEvent.wheel(screen.getByText('Comment 40'), {
    delta: { y: -1200 },
  });
  const reading = screen.getByText('Comment 20');
  await waitFor(() => expect(inView(reading, scrollport())).toBe(true));
  const before = reading.getBoundingClientRect().top;

  await userEvent.click(
    screen.getByRole('button', { name: 'Grow an earlier comment' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Comment 4').getBoundingClientRect().height).toBe(
      264,
    ),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));

  return reading.getBoundingClientRect().top - before;
}

describe("TaskThreadColumn holding a reader's place", () => {
  // Chromium and Firefox anchor scrolling themselves; Safari does not, so the
  // column does it there.
  it('keeps what a reader is reading still when a row above grows, in a browser that anchors scrolling', async () => {
    render(<Shifting />);

    expect(await growAboveTheReader()).toBeCloseTo(0, 0);
  });

  it('keeps what a reader is reading still when a row above grows, in Safari', async () => {
    renderLikeSafari();

    expect(await growAboveTheReader()).toBeCloseTo(0, 0);
  });

  it('leaves the place to a history load that holds it', async () => {
    renderLikeSafari();
    HELD_SCROLLPORTS.add(scrollport());

    expect(await growAboveTheReader()).toBeCloseTo(200, 0);
  });
});

function renderInDialog(rows: number) {
  // The board's dialog hosts the column with these props; a modal Radix
  // dialog locks the page's scroll and judges every wheel by what it finds.
  render(
    <ResponsiveDialog open>
      <ResponsiveDialogContent className="flex h-[480px] max-w-3xl flex-col overflow-hidden">
        <ResponsiveDialogTitle className="sr-only">Task</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          The task
        </ResponsiveDialogDescription>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <TaskThreadColumn
            brief={<p>The brief</p>}
            conversation={<Thread rows={rows} />}
            composer={<textarea aria-label="Comment" />}
            className="md:min-h-0"
            scrollerClassName="max-md:flex-none max-md:overflow-visible md:-ml-2 md:pl-2 md:pr-6"
            contentClassName="max-w-none px-0 pt-0.5 pb-4"
            composerClassName="max-w-none px-0 pb-0 md:pr-6"
          />
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
}

describe('TaskThreadColumn under a wheel', () => {
  it('scrolls up from its newest end on the task page', async () => {
    renderColumn(40);
    const newest = screen.getByText('Comment 40');
    const before = newest.getBoundingClientRect().top;

    await userEvent.wheel(newest, { delta: { y: -400 } });

    await waitFor(() =>
      expect(newest.getBoundingClientRect().top).toBeGreaterThan(before + 200),
    );
  });

  it("scrolls up from its newest end in the board's dialog", async () => {
    renderInDialog(40);
    const newest = await screen.findByText('Comment 40');
    const before = newest.getBoundingClientRect().top;

    await userEvent.wheel(newest, { delta: { y: -400 } });

    await waitFor(() =>
      expect(newest.getBoundingClientRect().top).toBeGreaterThan(before + 200),
    );
  });

  it("scrolls back down to the newest end in the board's dialog", async () => {
    renderInDialog(40);
    const newest = await screen.findByText('Comment 40');

    await wheelToTop(newest);
    await wheelToEnd(screen.getByText('The brief'), 'Comment 40');
  });
});
