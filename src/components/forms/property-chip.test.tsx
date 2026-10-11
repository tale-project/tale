import { CalendarDays } from 'lucide-react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Popover } from '../overlays/popover';
import { PropertyChip } from './property-chip';

describe('PropertyChip', () => {
  it('is a button named by its value, with a decorative glyph', () => {
    render(<PropertyChip icon={<CalendarDays />}>Today</PropertyChip>);
    const chip = screen.getByRole('button', { name: 'Today' });
    expect(chip).toHaveAttribute('type', 'button');
    expect(chip).toHaveClass('h-8', 'rounded-full', 'border');
    expect(chip).not.toHaveAttribute('data-empty');
    expect(chip.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBe(
      null,
    );
  });

  it('reads muted with a plus while the property is unset', () => {
    render(
      <PropertyChip empty icon={<CalendarDays data-testid="calendar" />}>
        Due date
      </PropertyChip>,
    );
    const chip = screen.getByRole('button', { name: 'Due date' });
    expect(chip).toHaveAttribute('data-empty');
    expect(chip).toHaveClass('text-muted-foreground');
    expect(screen.queryByTestId('calendar')).toBeNull();
    expect(chip.querySelectorAll('svg')).toHaveLength(1);
  });

  it('forwards its ref and props', async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    const { user } = render(
      <PropertyChip
        ref={ref}
        aria-label="Medium priority"
        data-field="priority"
        onClick={onClick}
      >
        Medium
      </PropertyChip>,
    );
    const chip = screen.getByRole('button', { name: 'Medium priority' });
    expect(ref.current).toBe(chip);
    expect(chip).toHaveAttribute('data-field', 'priority');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('serves as a picker trigger', async () => {
    const { user } = render(
      <Popover
        aria-label="Due date"
        trigger={<PropertyChip icon={<CalendarDays />}>Oct 12</PropertyChip>}
      >
        <p>Calendar</p>
      </Popover>,
    );
    const chip = screen.getByRole('button', { name: 'Oct 12' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(chip).toHaveAttribute('data-state', 'open');
    expect(await screen.findByText('Calendar')).toBeInTheDocument();
  });

  it('can be disabled', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <PropertyChip disabled onClick={onClick}>
        Today
      </PropertyChip>,
    );
    const chip = screen.getByRole('button', { name: 'Today' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <div>
          <PropertyChip icon={<CalendarDays />}>Today</PropertyChip>
          <PropertyChip empty>Due date</PropertyChip>
        </div>,
      );
      await checkAccessibility(container);
    });
  });
});
