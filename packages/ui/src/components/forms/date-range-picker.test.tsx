import { Skeletonize } from '@tale/ui/skeleton-context';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DatePickerWithRange } from './date-range-picker';

// The react-datepicker CustomInput renders buttons without accessible names
// that are internal to the third-party component. Disable that specific rule.
const a11yOptions = {
  rules: { 'button-name': { enabled: false } },
};

describe('DatePickerWithRange', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DatePickerWithRange onChange={vi.fn()} />);
      await checkAccessibility(container, a11yOptions);
    });

    it('passes axe audit with label and description', async () => {
      const { container } = render(
        <DatePickerWithRange
          onChange={vi.fn()}
          label="Date range"
          description="Select a start and end date"
        />,
      );
      await checkAccessibility(container, a11yOptions);
    });

    it('passes axe audit with error message', async () => {
      const { container } = render(
        <DatePickerWithRange
          onChange={vi.fn()}
          label="Date range"
          errorMessage="Please select a date range"
        />,
      );
      await checkAccessibility(container, a11yOptions);
    });
  });

  describe('in the UI language', () => {
    afterEach(() => {
      localStorage.removeItem('user-locale');
    });

    it.each([
      ['en-US', 'September 2026', 'Su', 'Choose', 'Month'],
      ['de', 'September 2026', 'Mo', 'Wähle', 'Monat'],
      ['de-CH', 'September 2026', 'Mo', 'Wähle', 'Monat'],
      ['fr', 'septembre 2026', 'lu', 'Choisir', 'Mois'],
    ])(
      '%s: names the month and weekdays and starts the week like the language',
      async (locale, month, firstWeekday, chooseLabel, monthLabel) => {
        localStorage.setItem('user-locale', locale);
        const { user } = render(
          <DatePickerWithRange
            onChange={vi.fn()}
            defaultDate={{
              from: new Date(2026, 8, 1),
              to: new Date(2026, 8, 29),
            }}
          />,
        );

        await user.click(screen.getByRole('button', { name: /2026/ }));

        expect(await screen.findByText(month)).toBeVisible();
        const weekdays = document.querySelectorAll(
          '.react-datepicker__day-name',
        );
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
  });

  describe('skeleton mode', () => {
    it('masks the picker trigger while loading', () => {
      render(
        <Skeletonize loading>
          <DatePickerWithRange onChange={vi.fn()} label="Date range" />
        </Skeletonize>,
      );
      // The react-datepicker trigger buttons are replaced by the mask.
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // The static label stays real.
      expect(screen.getByText('Date range')).toBeInTheDocument();
    });

    it('renders the real picker trigger when not loading', () => {
      render(
        <Skeletonize loading={false}>
          <DatePickerWithRange onChange={vi.fn()} label="Date range" />
        </Skeletonize>,
      );
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
  });
});
