import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Skeletonize } from '../feedback/skeleton-context';
import { CopyableField } from './copyable-field';

import '../../globals.css';

// Real-Chromium coverage of the secret and multi-line pills: what they look
// like next to the plain pill, and that nothing of a masked value shows.
afterEach(async () => {
  cleanup();
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
});

function box(element: Element) {
  return element.getBoundingClientRect();
}

const PASSWORD = 'correct horse battery staple';

describe('CopyableField of a secret (real layout)', () => {
  it('is as wide as the plain pills around it, with its buttons inside', () => {
    render(
      <div className="flex w-96 flex-col gap-4 p-8">
        <CopyableField
          label="Website"
          value="https://shop.example"
          mono={false}
        />
        <CopyableField masked label="Password" value={PASSWORD} mono={false} />
        <CopyableField wrap label="Note" value={'a\nb\nc'} mono={false} />
      </div>,
    );
    const website = box(screen.getByRole('button', { name: /^Website/ }));
    const password = box(screen.getByRole('group', { name: 'Password' }));
    const note = box(screen.getByRole('group', { name: 'Note' }));
    expect(password.left).toBe(website.left);
    expect(password.right).toBe(website.right);
    expect(note.left).toBe(website.left);
    expect(note.right).toBe(website.right);

    for (const name of ['Copy', 'Show value']) {
      const button = box(screen.getAllByRole('button', { name })[0]);
      expect(button.left).toBeGreaterThanOrEqual(password.left);
      expect(button.right).toBeLessThanOrEqual(password.right);
      expect(button.top).toBeGreaterThanOrEqual(password.top);
      expect(button.bottom).toBeLessThanOrEqual(password.bottom);
    }
    // A single line of dots is as tall as the plain pill, not taller.
    expect(Math.abs(password.height - website.height)).toBeLessThanOrEqual(1);
    // Three lines are taller.
    expect(note.height).toBeGreaterThan(website.height + 20);
  });

  it('puts nothing of a masked value on the page, not even where a tooltip would go', async () => {
    const { user } = render(
      <div className="w-96 p-8">
        <CopyableField masked label="Password" value={PASSWORD} />
      </div>,
    );
    const group = screen.getByRole('group', { name: 'Password' });
    await user.hover(group);
    await user.hover(screen.getByRole('button', { name: 'Copy' }));
    expect(document.body.innerText).not.toContain(PASSWORD);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('wraps a long value and a long line inside the pill instead of running out of it', async () => {
    const long = 'x'.repeat(200);
    const { user } = render(
      <div className="w-72 p-8">
        <CopyableField masked label="Token" value={long} />
        <CopyableField wrap label="Note" value={`${long}\nsecond`} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Show value' }));
    for (const name of ['Token', 'Note']) {
      const pill = screen.getByRole('group', { name });
      expect(pill.scrollWidth).toBeLessThanOrEqual(pill.clientWidth);
    }
  });

  it('keeps the touch targets of its two buttons apart while a finger is the pointer', async () => {
    await cdp().send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    render(
      <div className="w-96 p-8">
        <CopyableField masked label="Token" value="abc" />
      </div>,
    );
    const copy = box(screen.getByRole('button', { name: 'Copy' }));
    const show = box(screen.getByRole('button', { name: 'Show value' }));
    const y = (copy.top + copy.bottom) / 2;
    const buttonAt = (x: number) =>
      document
        .elementFromPoint(x, y)
        ?.closest('button')
        ?.getAttribute('aria-label') ?? null;

    // Each button's 44px target reaches 10px past its 24px box, so the boxes
    // sit 20px apart or the two targets overlap and the later one wins.
    expect(show.left - copy.right).toBeGreaterThanOrEqual(20);
    expect(buttonAt(copy.right + 4)).toBe('Copy');
    expect(buttonAt(copy.right + 8)).toBe('Copy');
    expect(buttonAt(show.left - 8)).toBe('Show value');
    expect(buttonAt(show.left - 4)).toBe('Show value');
  });

  it('has neither button drawn nor reachable while a Skeletonize around it loads', () => {
    const { container } = render(
      <Skeletonize loading>
        <div className="w-96 p-8">
          <CopyableField masked label="Token" value="abc" />
        </div>
      </Skeletonize>,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const rect = box(button);
      expect(getComputedStyle(button).visibility).toBe('hidden');
      const hit = document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
      expect(hit?.closest('button')).toBeNull();
    }
  });
});
