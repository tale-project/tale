import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Popover } from './popover';

import '../../globals.css';

// Real-Chromium coverage for a popover opened low on a short viewport — a
// laptop at 200 %, a phone held sideways. It kept its natural height and ran
// past the bottom of the window, its last controls out of reach; only a real
// engine positions it against the window.
afterEach(cleanup);

describe('Popover on a short viewport (real layout)', () => {
  it('stays inside the window and scrolls to its last control', async () => {
    await page.viewport(640, 360);
    const { user } = render(
      <div style={{ paddingTop: 200 }}>
        <Popover
          aria-label="Filters"
          trigger={<button type="button">Filter</button>}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <button key={i} type="button" className="block h-9">
              {`Option ${i + 1}`}
            </button>
          ))}
        </Popover>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    // Taller than the window on either side of its trigger: it must keep to
    // the window, whichever side it opens on, and scroll inside itself.
    const box = panel.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    const last = screen.getByRole('button', { name: 'Option 12' });
    panel.scrollTop = panel.scrollHeight;
    const rect = last.getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(box.bottom);
    expect(rect.top).toBeGreaterThanOrEqual(box.top);
  });
});
