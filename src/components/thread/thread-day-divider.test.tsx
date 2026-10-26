import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ThreadDayDivider } from './thread-day-divider';

describe('ThreadDayDivider', () => {
  it('names the day in a pill over a hairline', () => {
    const { container } = render(<ThreadDayDivider>Today</ThreadDayDivider>);

    expect(screen.getByText('Today')).toHaveClass(
      'rounded-full',
      'text-xs',
      'text-muted-foreground',
    );
    expect(
      container.querySelector('[data-slot="thread-day-rule"]'),
    ).toHaveAttribute('aria-hidden', 'true');
  });

  it('pins the pill by default, and not when asked', () => {
    const { container, rerender } = render(
      <ThreadDayDivider>Today</ThreadDayDivider>,
    );
    const divider = () =>
      container.querySelector('[data-slot="thread-day-divider"]');
    expect(divider()).toHaveClass('sticky', 'top-2', 'z-10');

    rerender(<ThreadDayDivider sticky={false}>Today</ThreadDayDivider>);
    expect(divider()).not.toHaveClass('sticky');
  });

  it('can be a heading when days structure the page', () => {
    render(<ThreadDayDivider as="h3">Yesterday</ThreadDayDivider>);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Yesterday' }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <div>
        <ThreadDayDivider>Monday, October 5</ThreadDayDivider>
        <p>An entry</p>
      </div>,
    );
    await checkAccessibility(container);
  });
});
