import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen } from '@/tests/utils/render';

import { TaskThreadColumn } from './task-thread-column';

import '@/app/globals.css';

// Real-Chromium coverage for the column the task page and the board's dialog
// share: where it opens, and that the composer stays in view.
afterEach(cleanup);

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
  const scroller = document.querySelector<HTMLElement>('.flex-col-reverse');
  if (scroller === null) throw new Error('no scrollport');
  return scroller;
}

function inView(element: HTMLElement, scroller: HTMLElement) {
  const box = element.getBoundingClientRect();
  const port = scroller.getBoundingClientRect();
  return box.bottom > port.top && box.top < port.bottom;
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

  it('keeps the composer under the thread while the thread scrolls', () => {
    const scroller = renderColumn(40);
    const composer = screen.getByRole('textbox', { name: 'Comment' });
    const before = composer.getBoundingClientRect().top;

    scroller.scrollTop = -scroller.scrollHeight;
    expect(inView(screen.getByText('The brief'), scroller)).toBe(true);
    expect(composer.getBoundingClientRect().top).toBe(before);
    expect(composer.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    );
  });
});
