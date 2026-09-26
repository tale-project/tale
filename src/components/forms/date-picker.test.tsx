import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DatePicker } from './date-picker';
import { DATE_PICKER_POPPER_ATTR } from './date-picker-popper';

describe('DatePicker', () => {
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
