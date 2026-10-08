import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '../overlays/responsive-dialog';
import { DatePicker } from './date-picker';
import { DATE_PICKER_POPPER_ATTR } from './date-picker-popper';

describe('DatePicker', () => {
  it('draws a bordered field by default and a borderless h-7 trigger as ghost', () => {
    const { rerender } = render(<DatePicker onChange={vi.fn()} />);
    const bordered = screen.getByRole('button', { name: /pick a date/i });
    expect(bordered.parentElement).toHaveClass('ring-1');
    expect(bordered).toHaveClass('h-9');

    rerender(<DatePicker onChange={vi.fn()} variant="ghost" />);
    const ghost = screen.getByRole('button', { name: /pick a date/i });
    expect(ghost.parentElement).not.toHaveClass('ring-1');
    expect(ghost).toHaveClass('h-7');
  });

  it('passes axe audit', async () => {
    const { container } = render(<DatePicker onChange={vi.fn()} />);
    await checkAccessibility(container);
  });

  it('opens the calendar on document.body so a dialog cannot clip it', async () => {
    const { user } = render(
      <div data-testid="scrollport" className="max-h-16 overflow-y-auto">
        <DatePicker onChange={vi.fn()} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /pick a date/i }));

    const calendar = document.querySelector('.react-datepicker');
    expect(calendar).not.toBeNull();
    expect(calendar?.closest(`[${DATE_PICKER_POPPER_ATTR}]`)).not.toBeNull();
    expect(screen.getByTestId('scrollport').contains(calendar)).toBe(false);
  });

  it('keeps the calendar open when navigating to the next month', async () => {
    const { user } = render(
      <DatePicker value={new Date(2026, 7, 15).getTime()} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /aug 15, 2026/i }));
    expect(screen.getByText('August 2026')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /next month/i }));

    expect(screen.getAllByText('September 2026').length).toBeGreaterThan(0);
    expect(document.querySelector('.react-datepicker')).not.toBeNull();
  });

  it('closes the calendar when clicking outside it', async () => {
    const { user } = render(
      <div>
        <DatePicker
          value={new Date(2026, 7, 15).getTime()}
          onChange={vi.fn()}
        />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /aug 15, 2026/i }));
    expect(document.querySelector('.react-datepicker')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(document.querySelector('.react-datepicker')).toBeNull();
  });

  it('stays clickable while a dialog has locked body pointer-events', async () => {
    const { user } = render(
      <DatePicker value={new Date(2026, 7, 15).getTime()} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /aug 15, 2026/i }));
    const popper = document.querySelector(`[${DATE_PICKER_POPPER_ATTR}]`);
    expect(popper).toBeInstanceOf(HTMLElement);

    document.body.style.pointerEvents = 'none';
    expect(getComputedStyle(popper as HTMLElement).pointerEvents).toBe('auto');
    document.body.style.pointerEvents = '';
  });
});

// The app shell's locale provider reads the saved preference, and its bridge
// switches the i18n language to it — the path a German or French user's
// picker takes in the running app.
const LOCALE_KEY = 'user-locale';

afterEach(() => {
  localStorage.removeItem(LOCALE_KEY);
});

function ControlledDatePicker({
  initial,
  onChange,
}: {
  initial?: number;
  onChange: (value: number | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DatePicker
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next ?? undefined);
      }}
    />
  );
}

const SEP_29_2026 = new Date(2026, 8, 29).getTime();

/** A stand-in for the language picker: it sets the saved preference. */
function SwitchToFrench() {
  const { setLocale } = useLocale();
  return (
    <button type="button" onClick={() => setLocale('fr')}>
      Français
    </button>
  );
}

describe('DatePicker in the UI language', () => {
  it.each([
    [
      'en-US',
      'Sep 29, 2026',
      'September 2026',
      'Su',
      'Clear date',
      'Choose',
      'Month',
    ],
    [
      'de',
      '29. Sep. 2026',
      'September 2026',
      'Mo',
      'Datum entfernen',
      'Wähle',
      'Monat',
    ],
    [
      'de-CH',
      '29. Sep. 2026',
      'September 2026',
      'Mo',
      'Datum entfernen',
      'Wähle',
      'Monat',
    ],
    [
      'fr',
      '29 sept. 2026',
      'septembre 2026',
      'lu',
      'Effacer la date',
      'Choisir',
      'Mois',
    ],
  ])(
    '%s: shows the date, month, weekdays and week start of the language',
    async (
      locale,
      shown,
      month,
      firstWeekday,
      clearLabel,
      chooseLabel,
      monthLabel,
    ) => {
      localStorage.setItem(LOCALE_KEY, locale);
      const { user } = render(
        <DatePicker value={SEP_29_2026} onChange={vi.fn()} />,
      );

      const trigger = await screen.findByRole('button', { name: shown });
      expect(
        screen.getByRole('button', { name: clearLabel }),
      ).toBeInTheDocument();

      await user.click(trigger);
      expect(screen.getByText(month)).toBeVisible();
      const weekdays = document.querySelectorAll('.react-datepicker__day-name');
      expect(weekdays).toHaveLength(7);
      expect(weekdays[0]).toHaveTextContent(firstWeekday);
      expect(
        screen
          .getAllByRole('gridcell')
          .every((cell) =>
            cell.getAttribute('aria-label')?.startsWith(chooseLabel + ' '),
          ),
      ).toBe(true);
      expect(
        screen.getByRole('rowgroup', {
          name: new RegExp('^' + monthLabel + ' '),
        }),
      ).toBeVisible();
    },
  );

  it('follows a language switch while it is on screen', async () => {
    const { user } = render(
      <>
        <SwitchToFrench />
        <DatePicker value={SEP_29_2026} onChange={vi.fn()} />
      </>,
    );
    expect(
      await screen.findByRole('button', { name: 'Sep 29, 2026' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Français' }));

    expect(
      await screen.findByRole('button', { name: '29 sept. 2026' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Effacer la date' }),
    ).toBeInTheDocument();
  });
});

describe('DatePicker clear button', () => {
  it('is offered only while a date is set and the picker is enabled', () => {
    const { rerender } = render(<DatePicker onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();

    rerender(<DatePicker value={SEP_29_2026} onChange={vi.fn()} disabled />);
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();

    rerender(<DatePicker value={SEP_29_2026} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Clear date' })).toBeVisible();
  });

  it('is a named button of its own, beside the trigger and not inside it', () => {
    render(<DatePicker value={SEP_29_2026} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Sep 29, 2026' });
    const clear = screen.getByRole('button', { name: 'Clear date' });

    expect(clear.tagName).toBe('BUTTON');
    expect(clear).toHaveAttribute('type', 'button');
    expect(clear).not.toHaveAttribute('aria-hidden');
    expect(clear).not.toHaveAttribute('tabindex', '-1');
    expect(clear.parentElement?.closest('button')).toBeNull();
    expect(trigger.contains(clear)).toBe(false);
    expect(trigger.parentElement).toBe(clear.parentElement);
    // A 24px target (WCAG 2.5.8); real layout is measured in the browser.
    expect(clear).toHaveClass('size-6');
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])(
    'clears from the keyboard with %s and hands focus back to the trigger',
    async (_key, keys) => {
      const onChange = vi.fn();
      const { user } = render(
        <ControlledDatePicker initial={SEP_29_2026} onChange={onChange} />,
      );

      await user.tab();
      expect(
        screen.getByRole('button', { name: 'Sep 29, 2026' }),
      ).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Clear date' })).toHaveFocus();

      await user.keyboard(keys);

      expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
      expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();
      expect(
        screen.getByRole('button', { name: /pick a date/i }),
      ).toHaveFocus();
      // Clearing is not opening: the calendar stays shut.
      expect(document.querySelector('.react-datepicker')).toBeNull();
    },
  );

  it('clears on click without opening the calendar', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ControlledDatePicker initial={SEP_29_2026} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear date' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.getByRole('button', { name: /pick a date/i })).toHaveFocus();
    expect(document.querySelector('.react-datepicker')).toBeNull();
  });

  it('passes axe audit with a date set', async () => {
    const { container } = render(
      <DatePicker value={SEP_29_2026} onChange={vi.fn()} />,
    );
    await checkAccessibility(container);
  });
});

describe('DatePicker popper container', () => {
  it('portals nothing while the calendar is closed', () => {
    render(<DatePicker onChange={vi.fn()} />);
    expect(document.querySelector(`[${DATE_PICKER_POPPER_ATTR}]`)).toBeNull();
  });

  it('names the open calendar as ONE dialog', async () => {
    const { user } = render(<DatePicker onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /pick a date/i }));
    const popper = document.querySelector(`[${DATE_PICKER_POPPER_ATTR}]`);
    expect(popper).toHaveAttribute('role', 'dialog');
    expect(popper).toHaveAccessibleName('Calendar');
    // react-datepicker's default container is a second, English-labelled
    // aria-modal dialog nested inside this one; the calendar body is plain.
    expect(popper?.querySelector('[role="dialog"]')).toBeNull();
    expect(popper?.querySelector('[aria-modal]')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(popper?.querySelector('.react-datepicker')).not.toBeNull();
  });

  it('stays perceivable inside a modal dialog', async () => {
    const { user } = render(
      <ResponsiveDialog open onOpenChange={vi.fn()}>
        <ResponsiveDialogContent closeLabel="Close">
          <ResponsiveDialogTitle>Task</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Due date</ResponsiveDialogDescription>
          <DatePicker onChange={vi.fn()} />
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    await user.click(screen.getByRole('button', { name: /pick a date/i }));
    const popper = document.querySelector(`[${DATE_PICKER_POPPER_ATTR}]`);
    expect(popper).not.toBeNull();
    expect(popper).not.toHaveAttribute('aria-hidden');
    expect(popper?.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Calendar' })).toBeVisible();
  });
});

describe('DatePicker bounds', () => {
  const SEP_15_2026 = new Date(2026, 8, 15).getTime();

  it('offers only the days between minDate and maxDate', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <DatePicker
        value={SEP_15_2026}
        minDate={new Date(2026, 8, 10).getTime()}
        maxDate={new Date(2026, 8, 20).getTime()}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sep 15, 2026' }));

    const before = screen.getByRole('gridcell', {
      name: /September 9th, 2026$/,
    });
    const inside = screen.getByRole('gridcell', {
      name: /September 12th, 2026$/,
    });
    const after = screen.getByRole('gridcell', {
      name: /September 21st, 2026$/,
    });
    expect(before).toHaveAttribute('aria-disabled', 'true');
    expect(after).toHaveAttribute('aria-disabled', 'true');
    expect(inside).toHaveAttribute('aria-disabled', 'false');
    // A day that cannot be picked says so in the UI language, not in
    // react-datepicker's built-in English.
    expect(before).toHaveAccessibleName(/^Not available /);
    expect(inside).toHaveAccessibleName(/^Choose /);

    await user.click(before);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(inside);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 12).getTime());
  });

  it('is named by the label it points at and keeps the chosen date', () => {
    render(
      <>
        <span id="expiry-label">Expiration date</span>
        <span id="expiry-hint">Up to one year from today.</span>
        <DatePicker
          id="expiry"
          aria-labelledby="expiry-label expiry"
          aria-describedby="expiry-hint"
          value={SEP_29_2026}
          onChange={vi.fn()}
        />
      </>,
    );
    const trigger = screen.getByRole('button', {
      name: 'Expiration date Sep 29, 2026',
    });
    expect(trigger).toHaveAttribute('id', 'expiry');
    expect(trigger).toHaveAccessibleDescription('Up to one year from today.');
  });
});
