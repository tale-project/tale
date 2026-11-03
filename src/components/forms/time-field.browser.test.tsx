import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { i18n as I18n } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import type { TimeOfDay } from '../../lib/time-of-day';
import { TimeField, type TimeFieldProps } from './time-field';

import '../../globals.css';

// Real-Chromium coverage for what jsdom fakes: colour contrast of the
// segments in both themes, the spoken values Chromium's ICU writes (with its
// narrow no-break space before AM/PM), a real clipboard event, the wheel,
// and the tab path through the parts.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

function Field({
  initial = { hour: 21, minute: 5 },
  ...rest
}: Partial<Omit<TimeFieldProps, 'value' | 'onValueChange'>> & {
  initial?: TimeOfDay;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      aria-label="Start"
      {...rest}
      value={value}
      onValueChange={setValue}
    />
  );
}

async function expectNoAxeViolations(element: Element) {
  const result = await axe.run(element, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  });
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
    ),
  ).toEqual([]);
}

/** Chromium writes U+202F before AM/PM; compare words, not the space. */
const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ');

/** A computed colour as sRGB channels, read back through a canvas so any
 *  syntax the engine computes reads the same way. */
function channels(color: string): [number, number, number] {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) throw new Error('No 2D canvas to read a colour');
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

/** WCAG relative luminance. */
function luminance(color: string): number {
  const [red, green, blue] = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].toSorted(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe.each(['light', 'dark'])('TimeField in %s', (theme) => {
  it('passes axe as a plain field, with an error and disabled', async () => {
    await page.viewport(1024, 768);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background flex flex-col gap-4 p-4">
        <Field hourCycle={12} />
        <Field
          label="Until"
          description="Local time."
          errorMessage="Pick a later time."
          hourCycle={24}
        />
        <Field aria-label="Locked" disabled hourCycle={24} />
        <Field aria-label="Read" readOnly size="sm" hourCycle={24} />
      </div>,
    );
    await expectNoAxeViolations(container);
    // A focused part is highlighted, and stays readable.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Start' })).getByRole(
        'spinbutton',
        { name: 'Hours' },
      ),
    );
    await expectNoAxeViolations(container);
  });

  it('fills the focused part so it stands out from the field', async () => {
    await page.viewport(1024, 768);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    render(<Field hourCycle={24} />);
    const group = screen.getByRole('group', { name: 'Start' });
    const [hour, minute] = within(group).getAllByRole('spinbutton');
    if (hour === undefined || minute === undefined) throw new Error('parts');
    const field = getComputedStyle(group).backgroundColor;
    await userEvent.click(hour);
    // Only the fill tells the parts apart: the ring is the group's.
    expect(
      contrast(getComputedStyle(hour).backgroundColor, field),
    ).toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(minute).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await userEvent.keyboard('{Tab}');
    expect(minute).toHaveFocus();
    expect(
      contrast(getComputedStyle(minute).backgroundColor, field),
    ).toBeGreaterThanOrEqual(3);
  });

  it('reads as text while read-only, in the same footprint', async () => {
    await page.viewport(1024, 768);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    render(
      <div className="bg-background flex flex-col gap-4 p-4">
        <Field aria-label="Edit" hourCycle={24} />
        <Field aria-label="Read" readOnly hourCycle={24} />
      </div>,
    );
    const editable = screen.getByRole('group', { name: 'Edit' });
    const readOnly = screen.getByRole('group', { name: 'Read' });
    const style = getComputedStyle(readOnly);
    expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(editable).borderTopColor).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    const [box, readBox] = [editable, readOnly].map((group) =>
      group.getBoundingClientRect(),
    );
    expect(readBox?.width).toBe(box?.width);
    expect(readBox?.height).toBe(box?.height);
    // No ring around the text, and the focused part still shows.
    const hour = within(readOnly).getByRole('spinbutton', { name: 'Hours' });
    await userEvent.click(hour);
    expect(hour).toHaveFocus();
    expect(getComputedStyle(readOnly).boxShadow).toBe('none');
    const surface = readOnly.parentElement;
    if (surface === null) throw new Error('No surface around the field');
    expect(
      contrast(
        getComputedStyle(hour).backgroundColor,
        getComputedStyle(surface).backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('TimeField in English', () => {
  it('speaks a 12-hour time and walks its parts with Tab and the arrows', async () => {
    await page.viewport(1024, 768);
    render(
      <>
        <button type="button">Before</button>
        <Field hourCycle={12} />
        <button type="button">After</button>
      </>,
    );
    const group = screen.getByRole('group', { name: 'Start' });
    expect(group).toHaveAccessibleDescription(/^9:05\sPM$/);
    const hour = within(group).getByRole('spinbutton', { name: 'Hours' });
    const minute = within(group).getByRole('spinbutton', { name: 'Minutes' });
    const period = within(group).getByRole('spinbutton', { name: 'AM/PM' });
    expect(plain(hour.getAttribute('aria-valuetext'))).toBe('9 PM');
    expect(minute).toHaveAttribute('aria-valuetext', '5 minutes');
    expect(period).toHaveAttribute('aria-valuetext', 'PM');

    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(hour).toHaveFocus();
    await userEvent.tab();
    expect(minute).toHaveFocus();
    await userEvent.tab();
    expect(period).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(hour).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(hour).toHaveValue('10');
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('takes a time pasted into any part', async () => {
    await page.viewport(1024, 768);
    render(<Field hourCycle={12} />);
    const group = screen.getByRole('group', { name: 'Start' });
    const minute = within(group).getByRole('spinbutton', { name: 'Minutes' });
    await userEvent.click(minute);
    const data = new DataTransfer();
    data.setData('text/plain', '17h30');
    minute.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(group).getByRole('spinbutton', { name: 'Hours' }),
      ).toHaveValue('5'),
    );
    expect(minute).toHaveValue('30');
    expect(minute).toHaveFocus();
  });

  it('ignores the wheel', async () => {
    await page.viewport(1024, 768);
    render(<Field hourCycle={12} />);
    const hour = within(screen.getByRole('group', { name: 'Start' })).getByRole(
      'spinbutton',
      { name: 'Hours' },
    );
    await userEvent.click(hour);
    await userEvent.wheel(hour, { delta: { y: -300 } });
    expect(hour).toHaveValue('9');
  });

  it('keeps every part at least 24px wide and the field one line', async () => {
    await page.viewport(320, 640);
    render(<Field hourCycle={12} />);
    const group = screen.getByRole('group', { name: 'Start' });
    for (const part of within(group).getAllByRole('spinbutton')) {
      const box = part.getBoundingClientRect();
      expect(box.width, part.outerHTML).toBeGreaterThanOrEqual(24);
      expect(box.height, part.outerHTML).toBeGreaterThanOrEqual(24);
      expect(part.scrollWidth, part.outerHTML).toBeLessThanOrEqual(
        part.clientWidth,
      );
    }
    expect(group.getBoundingClientRect().height).toBe(36);
  });
});

describe('TimeField in German', () => {
  const shared: { i18n?: I18n } = {};
  function CaptureI18n() {
    const { i18n } = useTranslation();
    useEffect(() => {
      shared.i18n = i18n;
    }, [i18n]);
    return null;
  }
  afterEach(async () => {
    cleanup();
    await shared.i18n?.changeLanguage('en-US');
  });

  it('counts 24 hours, names its parts in German and has no day period', async () => {
    await page.viewport(1024, 768);
    localStorage.setItem('user-locale', 'de');
    render(
      <>
        <CaptureI18n />
        <Field />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Start' });
    const hour = await within(group).findByRole('spinbutton', {
      name: 'Stunden',
    });
    expect(hour).toHaveValue('21');
    expect(hour).toHaveAttribute('aria-valuemax', '23');
    expect(hour).toHaveAttribute('aria-valuetext', '21 Uhr');
    const minute = within(group).getByRole('spinbutton', { name: 'Minuten' });
    expect(minute).toHaveAttribute('aria-valuetext', '5 Minuten');
    expect(
      within(group).queryByRole('spinbutton', { name: 'AM/PM' }),
    ).toBeNull();
    await expectNoAxeViolations(group);
  });
});
