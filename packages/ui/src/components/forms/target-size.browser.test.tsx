import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { Checkbox } from './checkbox';
import { Switch } from './switch';

import '../../globals.css';

// Real-Chromium coverage for WCAG 2.5.8 (target size, minimum): a checkbox is
// a 16px box and a switch an 18px-tall track, both under the 24px a pointer
// may be asked to hit. An invisible ring around each takes the tap too; only
// hit-testing in a real engine can say where the target actually ends.
afterEach(cleanup);

/** What a tap `offset` px outside each edge of `el`'s box lands on. */
function tapsAround(el: HTMLElement, offset: number) {
  const r = el.getBoundingClientRect();
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const lands = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (hit === el || el.contains(hit));
  };
  return {
    left: lands(r.left - offset, cy),
    right: lands(r.right + offset, cy),
    top: lands(cx, r.top - offset),
    bottom: lands(cx, r.bottom + offset),
  };
}

const everywhere = { left: true, right: true, top: true, bottom: true };

describe('small controls keep a 24px target (real layout)', () => {
  it('takes a tap up to 4px outside a checkbox', () => {
    render(
      <div className="p-8">
        <Checkbox aria-label="Select row" />
      </div>,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Select row' });
    expect(checkbox.getBoundingClientRect().width).toBe(16);
    // 16 + 2 × 4 = 24: the target's edge, just inside it.
    expect(tapsAround(checkbox, 3.5)).toEqual(everywhere);
  });

  it('takes a tap above and below a switch up to its 24px', () => {
    render(
      <div className="p-8">
        <Switch aria-label="Email me" />
      </div>,
    );
    const toggle = screen.getByRole('switch', { name: 'Email me' });
    const { height } = toggle.getBoundingClientRect();
    expect(height).toBeLessThan(24);
    // Half of what the track lacks to 24px, on each side.
    expect(tapsAround(toggle, (24 - height) / 2 - 0.5)).toEqual(everywhere);
  });
});
