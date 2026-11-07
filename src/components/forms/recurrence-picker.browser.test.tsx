import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import type { i18n as I18n } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import type {
  CalendarDay,
  RecurrenceReference,
  RecurrenceRule,
} from '../../lib/recurrence/rule';
import { Dialog } from '../dialog/dialog';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '../overlays/responsive-dialog';
import { Checkbox } from './checkbox';
import { RecurrencePicker } from './recurrence-picker';

import '../../globals.css';

// Real-Chromium coverage for what jsdom fakes: colour contrast in both
// themes, the one-line trigger that drops its tail whole, overflow in the
// 288px popover in German and French, focus trapping and wheel scrolling
// inside a Dialog and a vaul Drawer, and nested Escape.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

/** Tue Sep 29, 2026. */
const TUESDAY: RecurrenceReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

const WEEKLY_TUE_THU: RecurrenceRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [2, 4],
};

/** A stand-in for the host's calendar arithmetic: the next three Tuesdays. */
function nextDates(): CalendarDay[] {
  return [6, 13, 20].map((day) => ({ year: 2026, month: 10, day }));
}

function Picker({
  initial = WEEKLY_TUE_THU,
  className,
}: {
  initial?: RecurrenceRule | null;
  className?: string;
}) {
  const [value, setValue] = useState<RecurrenceRule | null>(initial);
  const [onDue, setOnDue] = useState(false);
  return (
    <RecurrencePicker<boolean>
      value={value}
      reference={TUESDAY}
      nextDates={nextDates}
      description="The next task is created when this one is done."
      extra={onDue}
      onChange={(rule, next) => {
        setValue(rule);
        setOnDue(next);
      }}
      renderExtra={({ rule, extra, setExtra }) =>
        rule ? (
          <Checkbox
            label="Create the next task on the due date"
            description="Even if this one is still open on Tue, Sep 29."
            checked={extra}
            onCheckedChange={(checked) => setExtra(checked === true)}
          />
        ) : null
      }
      className={className}
    />
  );
}

async function openPopover() {
  await page.getByRole('button', { name: /^Repeat/ }).click();
  return screen.findByRole('dialog', { name: 'Repeat' });
}

async function expectNoAxeViolations(element: Element) {
  // Contrast is judged on the settled layer, not halfway through its fade-in.
  await Promise.all(
    element
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished),
  );
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

describe.each(['light', 'dark'])('RecurrencePicker in %s', (theme) => {
  it('passes axe on the trigger, the preset view and the Custom view', async () => {
    await page.viewport(1280, 900);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background w-60 p-4">
        <Picker />
      </div>,
    );
    await expectNoAxeViolations(container);
    const dialog = await openPopover();
    await expectNoAxeViolations(dialog);
    await page.getByRole('button', { name: 'Custom' }).click();
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'Week' })).toHaveFocus(),
    );
    await expectNoAxeViolations(dialog);
  });
});

describe('RecurrencePicker keyboard path', () => {
  it('walks the preset view, the Custom view and back without a pointer', async () => {
    await page.viewport(1280, 900);
    render(
      <>
        <button type="button">Before</button>
        <Picker />
      </>,
    );
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    const trigger = screen.getByRole('button', {
      name: 'Repeat: Weekly, Tue, Thu',
    });
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
    const custom = within(dialog).getByRole('button', { name: 'Custom' });
    // A custom rule: focus starts on the Custom row.
    await waitFor(() => expect(custom).toHaveFocus());

    // Presets are one stop; arrows move and never select.
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole('radio', { name: 'Never' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('radio', { name: 'Daily' }),
      ).toHaveFocus(),
    );
    await userEvent.tab();
    expect(custom).toHaveFocus();
    await userEvent.tab();
    expect(
      within(dialog).getByRole('checkbox', {
        name: 'Create the next task on the due date',
      }),
    ).toHaveFocus();

    // Into the Custom view: the unit, the interval, the weekdays, the footer.
    await userEvent.tab({ shift: true });
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'Week' })).toHaveFocus(),
    );
    await userEvent.tab({ shift: true });
    expect(
      within(dialog).getByRole('button', { name: 'Back to presets' }),
    ).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    expect(
      within(dialog).getByRole('spinbutton', { name: 'Every 1 week' }),
    ).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.tab();
    const tuesday = within(dialog).getByRole('button', { name: 'Tuesday' });
    expect(tuesday).toHaveFocus();
    // Radix moves roving focus a task later: one key at a time.
    for (const day of ['Wednesday', 'Thursday', 'Friday']) {
      await userEvent.keyboard('{ArrowRight}');
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: day })).toHaveFocus(),
      );
    }
    await userEvent.keyboard(' ');
    await userEvent.tab();
    await userEvent.tab();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await userEvent.tab();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^Repeat: Every 2 weeks/ }),
      ).toHaveFocus();
    });
    expect(
      screen.getByRole('button', { name: /^Repeat: Every 2 weeks/ }),
    ).toHaveAccessibleDescription(
      'Every 2 weeks on Tuesday, Thursday, and Friday The next task is created when this one is done.',
    );
  });

  it('returns from the Custom view to the Custom row with Back', async () => {
    await page.viewport(1280, 900);
    render(<Picker initial={null} />);
    const dialog = await openPopover();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('radio', { name: 'Never' }),
      ).toHaveFocus(),
    );
    await page.getByRole('button', { name: 'Custom' }).click();
    await page.getByRole('button', { name: 'Back to presets' }).click();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Custom' }),
      ).toHaveFocus(),
    );
    // The draft moved with Custom (weekly on the reference weekday).
    expect(
      within(dialog).getByRole('radio', { name: 'Weekly on Tuesday' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

describe('RecurrencePicker trigger width', () => {
  function tailAndHead(trigger: HTMLElement) {
    const head = within(trigger).getByText('Weekly');
    const tail = within(trigger).getByText(/Tue, Thu/);
    return { head, tail };
  }

  it('keeps the tail on the line in a 192px column', async () => {
    await page.viewport(1280, 900);
    render(
      <div style={{ width: 192 }}>
        <Picker />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /^Repeat/ });
    const { head, tail } = tailAndHead(trigger);
    expect(tail.offsetTop).toBe(head.offsetTop);
    expect(trigger.getBoundingClientRect().height).toBe(28);
  });

  it('drops the whole tail in a 128px column, and keeps it in the name', async () => {
    await page.viewport(1280, 900);
    render(
      <div style={{ width: 128 }}>
        <Picker />
      </div>,
    );
    const trigger = screen.getByRole('button', {
      name: 'Repeat: Weekly, Tue, Thu',
    });
    const { head, tail } = tailAndHead(trigger);
    expect(tail.offsetTop).toBeGreaterThan(head.offsetTop);
    // The tail sits on the hidden second line: nothing of it shows.
    const line = head.parentElement;
    expect(line).not.toBeNull();
    expect(tail.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      line?.getBoundingClientRect().bottom ?? Infinity,
    );
    expect(trigger.getBoundingClientRect().height).toBe(28);
  });
});

describe.each(['de', 'fr'])('RecurrencePicker in %s', (locale) => {
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

  it('fits every view in the 288px popover without horizontal overflow', async () => {
    await page.viewport(1280, 900);
    localStorage.setItem('user-locale', locale);
    render(
      <>
        <CaptureI18n />
        <Picker
          initial={{ frequency: 'weekly', interval: 2, weekdays: [2, 4] }}
        />
      </>,
    );
    const trigger = await screen.findByRole('button', {
      name: locale === 'de' ? /^Wiederholen:/ : /^Répéter :/,
    });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getBoundingClientRect().width).toBe(288);

    const expectNoOverflow = () => {
      const box = dialog.getBoundingClientRect();
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
    await userEvent.click(
      within(dialog).getByRole('button', {
        name: locale === 'de' ? 'Benutzerdefiniert' : 'Personnalisé',
      }),
    );
    expectNoOverflow();
    for (const unit of locale === 'de'
      ? ['Tag', 'Monat', 'Jahr']
      : ['Jour', 'Mois', 'Année']) {
      await userEvent.click(within(dialog).getByRole('radio', { name: unit }));
      expectNoOverflow();
    }
  });
});

describe('RecurrencePicker in a Dialog', () => {
  function InDialog() {
    return (
      <Dialog open onOpenChange={() => {}} title="Create task">
        <div className="flex flex-col gap-2">
          <button type="button">Title</button>
          <Picker />
        </div>
      </Dialog>
    );
  }

  it('traps focus in the popover, restores it, and leaves the dialog open', async () => {
    await page.viewport(1280, 900);
    render(<InDialog />);
    const host = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.click(
      within(host).getByRole('button', { name: /^Repeat/ }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Repeat' });
    await waitFor(() =>
      expect(popover.contains(document.activeElement)).toBe(true),
    );
    for (let index = 0; index < 8; index++) {
      await userEvent.tab();
      expect(popover.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Repeat' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeVisible();
    await waitFor(() =>
      expect(
        within(host).getByRole('button', { name: /^Repeat/ }),
      ).toHaveFocus(),
    );
  });

  it('scrolls inside the popover with the wheel on a short viewport', async () => {
    await page.viewport(900, 420);
    render(<InDialog />);
    const host = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.click(
      within(host).getByRole('button', { name: /^Repeat/ }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Repeat' });
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Custom' }),
    );
    await waitFor(() =>
      expect(popover.scrollHeight).toBeGreaterThan(popover.clientHeight),
    );
    expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(420);
    const before = popover.scrollTop;
    await userEvent.wheel(popover, { delta: { y: 400 } });
    await waitFor(() => expect(popover.scrollTop).toBeGreaterThan(before));
  });

  it('keeps its side when the view switches', async () => {
    await page.viewport(900, 640);
    render(<InDialog />);
    const host = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.click(
      within(host).getByRole('button', { name: /^Repeat/ }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Repeat' });
    const side = popover.getAttribute('data-side');
    expect(side).not.toBeNull();
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Custom' }),
    );
    await within(popover).findByRole('radiogroup', { name: 'Unit' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(popover.getAttribute('data-side')).toBe(side);
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Back to presets' }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(popover.getAttribute('data-side')).toBe(side);
  });

  it('closes only the month list on Escape', async () => {
    await page.viewport(1280, 900);
    render(<InDialog />);
    const host = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.click(
      within(host).getByRole('button', { name: /^Repeat/ }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Repeat' });
    await userEvent.click(
      within(popover).getByRole('button', { name: 'Custom' }),
    );
    await userEvent.click(within(popover).getByRole('radio', { name: 'Year' }));
    await userEvent.click(
      within(popover).getByRole('combobox', { name: 'Month' }),
    );
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Repeat' })).toBeVisible();
    // Still open underneath; the modal popover hides it from the tree.
    expect(host).toBeInTheDocument();
    expect(host).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Repeat' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeVisible();
  });
});

describe('RecurrencePicker in a vaul Drawer', () => {
  it('opens, traps focus, and closes on Escape without closing the drawer', async () => {
    // Below `md`, ResponsiveDialog is a vaul bottom drawer — the phone sheet.
    await page.viewport(390, 844);
    render(
      <ResponsiveDialog open onOpenChange={() => {}}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Create task</ResponsiveDialogTitle>
          <Picker />
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Create task' });
    expect(drawer).toHaveAttribute('data-vaul-drawer');
    await userEvent.click(
      within(drawer).getByRole('button', { name: /^Repeat/ }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Repeat' });
    const box = popover.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    await waitFor(() =>
      expect(popover.contains(document.activeElement)).toBe(true),
    );
    for (let index = 0; index < 6; index++) {
      await userEvent.tab();
      expect(popover.contains(document.activeElement)).toBe(true);
    }
    // A pointer tap on a preset works inside the drawer.
    await userEvent.click(
      within(popover).getByRole('radio', { name: 'Daily' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Repeat' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(drawer).getByRole('button', { name: 'Repeat: Daily' }),
    ).toBeVisible();
    await userEvent.click(
      within(drawer).getByRole('button', { name: /^Repeat/ }),
    );
    await screen.findByRole('dialog', { name: 'Repeat' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Repeat' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeVisible();
  });
});
