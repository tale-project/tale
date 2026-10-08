import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { i18n as I18n } from 'i18next';
import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import type {
  ScheduleOccurrence,
  ScheduleReference,
  ScheduleRule,
} from '../../lib/recurrence/schedule';
import { RecurrencePicker } from './recurrence-picker';

import '../../globals.css';

// Real-Chromium coverage for the picker's time mode: contrast of every view
// in both themes, the keyboard path through the views, focus after adding
// and removing a time, the 320px popover in English, German and French at a
// phone's width, the swap fade between views and its absence under reduced
// motion.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

/** Tue Sep 29, 2026. */
const TUESDAY: ScheduleReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

const WEEKDAYS_TWICE: ScheduleRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1, 2, 3, 4, 5],
  times: ['09:00', '17:30'],
};

/** A stand-in for the host's engine: three fixed starts in Zurich. */
function nextOccurrences(): ScheduleOccurrence[] {
  return [30, 31].map((day) => ({
    at: Date.UTC(2026, 8, day, 7, 0),
    timeZone: 'Europe/Zurich',
  }));
}

function Picker({ initial = WEEKDAYS_TWICE }: { initial?: ScheduleRule }) {
  const [value, setValue] = useState<ScheduleRule>(initial);
  return (
    <RecurrencePicker
      granularity="time"
      allowNever={false}
      variant="default"
      align="start"
      icon={CalendarClock}
      reference={TUESDAY}
      value={value}
      nextOccurrences={nextOccurrences}
      onChange={setValue}
    />
  );
}

async function settle(element: Element) {
  await Promise.all(
    element
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished),
  );
}

async function expectNoAxeViolations(element: Element) {
  // Contrast is judged on the settled layer, not halfway through its fade.
  await settle(element);
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

async function openPopover() {
  await page.getByRole('button', { name: /^Schedule/ }).click();
  return screen.findByRole('dialog', { name: 'Schedule' });
}

describe.each(['light', 'dark'])('the schedule picker in %s', (theme) => {
  it('passes axe on the trigger, the presets, Custom interval and Custom times', async () => {
    await page.viewport(1280, 900);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background w-72 p-4">
        <Picker
          initial={{
            frequency: 'hourly',
            interval: 6,
            minute: 0,
            window: {
              weekdays: [1, 2, 3, 4, 5],
              hours: { from: '08:00', to: '18:00' },
            },
          }}
        />
      </div>,
    );
    await expectNoAxeViolations(container);
    const dialog = await openPopover();
    await expectNoAxeViolations(dialog);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Custom interval' }),
    );
    await within(dialog).findByRole('combobox', { name: 'Every' });
    await expectNoAxeViolations(dialog);
    // A window no run falls in: the red hint and the blocked Save.
    const until = within(dialog).getByRole('group', { name: 'Until' });
    await userEvent.click(
      within(until).getByRole('spinbutton', { name: 'Hours' }),
    );
    // 8:00 AM to 11:00 AM: every 6 hours from midnight starts at 6 and 12.
    await userEvent.keyboard('1100a');
    await within(dialog).findByText(/^No run falls between/);
    await expectNoAxeViolations(dialog);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Back to presets' }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Custom times' }),
    );
    await within(dialog).findByRole('list', { name: 'At' });
    await expectNoAxeViolations(dialog);
  });
});

describe('the schedule picker from the keyboard', () => {
  it('walks the presets, Custom times and Save without a pointer', async () => {
    await page.viewport(1280, 900);
    render(
      <>
        <button type="button">Before</button>
        <Picker />
      </>,
    );
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Schedule' });
    const times = within(dialog).getByRole('button', { name: 'Custom times' });
    // A custom rule of the times kind: focus starts on its row.
    await waitFor(() => expect(times).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'Week' })).toHaveFocus(),
    );
    // Through the editor to the first time, then Add time.
    const at = within(dialog).getByRole('list', { name: 'At' });
    const firstHour = within(
      within(at).getByRole('group', { name: 'Time 1' }),
    ).getByRole('spinbutton', { name: 'Hours' });
    firstHour.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(firstHour).toHaveValue('10');
    const add = within(dialog).getByRole('button', { name: 'Add time' });
    add.focus();
    await userEvent.keyboard('{Enter}');
    const third = within(at).getByRole('group', { name: 'Time 3' });
    await waitFor(() =>
      expect(
        within(third).getByRole('spinbutton', { name: 'Hours' }),
      ).toHaveFocus(),
    );
    // Remove it again: focus moves to the row now last.
    const remove = within(at)
      .getAllByRole('button', { name: /^Remove/ })
      .at(-1) as HTMLElement;
    remove.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        within(within(at).getByRole('group', { name: 'Time 2' })).getByRole(
          'spinbutton',
          { name: 'Hours' },
        ),
      ).toHaveFocus(),
    );
    // Enter in a time field saves.
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^Schedule: Weekdays/ }),
      ).toHaveFocus();
    });
    expect(
      screen.getByRole('button', { name: /^Schedule: Weekdays/ }),
    ).toHaveAccessibleDescription(/^Every weekday at 10:00\sAM and 5:30\sPM$/);
  });

  it('returns to the row that opened a custom view with Back', async () => {
    await page.viewport(1280, 900);
    render(<Picker />);
    const dialog = await openPopover();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Custom interval' }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Back to presets' }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Custom interval' }),
      ).toHaveFocus(),
    );
  });
});

describe('the swap fade between views', () => {
  it('fades the new view in, opacity only', async () => {
    await page.viewport(1280, 900);
    render(<Picker />);
    const dialog = await openPopover();
    await settle(dialog);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Custom times' }),
    );
    const fades = dialog
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof Animation);
    expect(fades.length).toBeGreaterThan(0);
    const effect = fades[0]?.effect;
    expect(effect).toBeInstanceOf(KeyframeEffect);
    const frames = (effect as KeyframeEffect).getKeyframes();
    expect(frames.every((frame) => frame.transform === undefined)).toBe(true);
    expect(frames.map((frame) => frame.opacity)).toEqual(['0.35', '1']);
  });

  it('switches instantly under reduced motion', async () => {
    await page.viewport(1280, 900);
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const list = real(query);
      if (!query.includes('prefers-reduced-motion')) return list;
      // The reader asked for less motion.
      return Object.defineProperty(list, 'matches', { value: true });
    });
    render(<Picker />);
    const dialog = await openPopover();
    await settle(dialog);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Custom times' }),
    );
    await within(dialog).findByRole('list', { name: 'At' });
    const opacityFades = dialog
      .getAnimations({ subtree: true })
      .filter((animation) =>
        (animation.effect as KeyframeEffect | null)
          ?.getKeyframes()
          .some((frame) => frame.opacity === '0.35'),
      );
    expect(opacityFades).toEqual([]);
  });
});

describe.each(['en', 'de', 'fr'])(
  'the schedule picker in %s at 320px',
  (locale) => {
    // The tree holds the language it detected while it is mounted; unmount
    // it, then hand the shared i18n instance back in English.
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

    it('fits every view without horizontal overflow', async () => {
      await page.viewport(320, 720);
      localStorage.setItem('user-locale', locale);
      render(
        <div className="p-2">
          <CaptureI18n />
          <Picker
            initial={{
              frequency: 'hourly',
              interval: 2,
              minute: 15,
              window: {
                weekdays: [1, 2, 3, 4, 5],
                hours: { from: '08:00', to: '18:00' },
              },
            }}
          />
        </div>,
      );
      const trigger = await screen.findByRole('button', {
        name: { en: /^Schedule:/, de: /^Zeitplan:/, fr: /^Planification\s:/ }[
          locale
        ],
      });
      await userEvent.click(trigger);
      const dialog = await screen.findByRole('dialog');
      await settle(dialog);
      const expectNoOverflow = () => {
        const box = dialog.getBoundingClientRect();
        expect(box.right).toBeLessThanOrEqual(320);
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        for (const element of dialog.querySelectorAll<HTMLElement>(
          'button, input, [role="radio"], [role="combobox"], p, li',
        )) {
          const rect = element.getBoundingClientRect();
          expect(rect.right, element.outerHTML).toBeLessThanOrEqual(
            box.right + 0.5,
          );
        }
      };
      expectNoOverflow();
      const rows = within(dialog).getAllByRole('button');
      const customInterval = rows.find((row) =>
        /Custom interval|Benutzerdefiniertes Intervall|Intervalle personnalisé/.test(
          row.textContent ?? '',
        ),
      );
      await userEvent.click(customInterval as HTMLElement);
      await settle(dialog);
      expectNoOverflow();
      const back = within(dialog).getAllByRole('button')[0] as HTMLElement;
      await userEvent.click(back);
      const customTimes = within(dialog)
        .getAllByRole('button')
        .find((row) =>
          /Custom times|Benutzerdefinierte Uhrzeiten|Horaires personnalisés/.test(
            row.textContent ?? '',
          ),
        );
      await userEvent.click(customTimes as HTMLElement);
      await settle(dialog);
      expectNoOverflow();
    });
  },
);
