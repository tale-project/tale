import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { ThreadHeader } from './thread-header';

import '@tale/ui/globals.css';

// Real-Chromium coverage for the header as a size container: an action's
// label keyed on the header's own width. Keyed on the window instead, a
// tablet's header — ~435px beside the rail and a panel in a 768px window —
// spent its width on labels and cut the title and its context line short.
afterEach(cleanup);

beforeEach(async () => {
  // Wider than every viewport breakpoint such a label used to wait for.
  await page.viewport(1024, 768);
});

function renderHeader(width: number) {
  render(
    <div style={{ width }}>
      <ThreadHeader
        title={<h1>Review the launch checklist</h1>}
        actions={
          <button type="button" aria-label="Open board">
            <span className="hidden @xl/thread-header:inline">Board</span>
          </button>
        }
      />
    </div>,
  );
}

describe('ThreadHeader width (real layout)', () => {
  it('keeps an action icon-only in a narrow header, however wide the window', () => {
    renderHeader(435);
    expect(screen.getByText('Board')).not.toBeVisible();
  });

  it('shows the action label once the header itself has room', () => {
    renderHeader(700);
    expect(screen.getByText('Board')).toBeVisible();
  });
});
