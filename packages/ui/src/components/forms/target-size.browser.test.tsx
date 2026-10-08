import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Checkbox } from './checkbox';
import { DatePicker } from './date-picker';
import { NumberStepper } from './number-stepper';
import { RecurrencePicker } from './recurrence-picker';
import { Switch } from './switch';
import { TimeField } from './time-field';
import { ToggleChipGroup } from './toggle-chip-group';

import '../../globals.css';

// Real-Chromium coverage for WCAG 2.5.8 (target size, minimum): a checkbox is
// a 16px box and a switch an 18px-tall track, both under the 24px a pointer
// may be asked to hit. An invisible ring around each takes the tap too; only
// hit-testing in a real engine can say where the target actually ends. The
// date picker's clear button carries a 14px glyph in a box of its own.
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

  it.each(['default', 'ghost'] as const)(
    "gives the %s date picker's clear button a whole 24px box",
    (variant) => {
      render(
        <div className="w-64 p-8">
          <DatePicker
            value={new Date(2026, 8, 29).getTime()}
            onChange={() => {}}
            variant={variant}
          />
        </div>,
      );
      const clear = screen.getByRole('button', { name: 'Clear date' });
      const { width, height } = clear.getBoundingClientRect();
      expect(width).toBeGreaterThanOrEqual(24);
      expect(height).toBeGreaterThanOrEqual(24);
      // The glyph is smaller; a tap anywhere in the box still clears.
      expect(tapsAround(clear, -1)).toEqual(everywhere);
    },
  );
});

/** Width and height of an element's box. */
function size(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

describe('recurrence controls keep their targets (real layout)', () => {
  it('gives weekday chips 32px and stepper buttons a 32px column', () => {
    render(
      <div className="flex flex-col gap-4 p-8">
        <ToggleChipGroup
          aria-label="Days"
          value={['1']}
          onValueChange={() => {}}
          options={[
            { value: '1', label: 'Mo', 'aria-label': 'Monday' },
            { value: '2', label: 'Tu', 'aria-label': 'Tuesday' },
          ]}
        />
        <NumberStepper
          aria-label="Interval"
          value={2}
          min={1}
          max={9}
          onValueChange={() => {}}
        />
      </div>,
    );
    for (const name of ['Monday', 'Tuesday']) {
      const { width, height } = size(screen.getByRole('button', { name }));
      expect(width).toBeGreaterThanOrEqual(32);
      expect(height).toBe(32);
    }
    for (const name of ['Decrease', 'Increase']) {
      const { width, height } = size(screen.getByRole('button', { name }));
      expect(width).toBe(32);
      expect(height).toBeGreaterThanOrEqual(32);
    }
  });

  it('keeps the trigger at 28px and the popover rows at 36px, Back at 32px', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="w-60 p-8">
        <RecurrencePicker
          value={{ frequency: 'daily', interval: 1 }}
          reference={{ year: 2026, month: 9, day: 29, weekday: 2 }}
          onChange={() => {}}
        />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Repeat: Daily' });
    expect(size(trigger).height).toBe(28);
    trigger.click();
    const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
    await Promise.all(
      dialog
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
    for (const row of within(dialog).getAllByRole('radio')) {
      expect(size(row).height).toBeCloseTo(36, 0);
    }
    expect(
      size(within(dialog).getByRole('button', { name: 'Custom' })).height,
    ).toBeCloseTo(36, 0);
    within(dialog).getByRole('button', { name: 'Custom' }).click();
    const back = await within(dialog).findByRole('button', {
      name: 'Back to presets',
    });
    await Promise.all(
      dialog
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
    expect(size(back).width).toBeCloseTo(32, 0);
    expect(size(back).height).toBeCloseTo(32, 0);
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'Week' })).toBeVisible(),
    );
    for (const segment of within(
      within(dialog).getByRole('radiogroup', { name: 'Unit' }),
    ).getAllByRole('radio')) {
      expect(size(segment).height).toBeGreaterThanOrEqual(24);
      expect(size(segment).width).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('time field parts keep their targets (real layout)', () => {
  it.each([
    ['default', 1280],
    ['default', 375],
    ['sm', 1280],
  ] as const)('gives every %s part 24px at %ipx', async (fieldSize, width) => {
    await page.viewport(width, 800);
    render(
      <div className="p-8">
        <TimeField
          aria-label="Start"
          hourCycle={12}
          size={fieldSize}
          value={{ hour: 21, minute: 5 }}
          onValueChange={() => {}}
        />
      </div>,
    );
    const group = screen.getByRole('group', { name: 'Start' });
    for (const part of within(group).getAllByRole('spinbutton')) {
      expect(
        size(part).width,
        part.getAttribute('aria-label') ?? '',
      ).toBeGreaterThanOrEqual(24);
      expect(
        size(part).height,
        part.getAttribute('aria-label') ?? '',
      ).toBeGreaterThanOrEqual(24);
    }
  });
});
