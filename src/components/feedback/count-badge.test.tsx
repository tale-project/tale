import { describe, it, expect } from 'vitest';

import { render } from '@/tests/utils/render';

import { CountBadge } from './count-badge';

function chip(container: HTMLElement) {
  return container.querySelector('[data-slot="count-badge"]');
}

describe('CountBadge', () => {
  it('prints the count', () => {
    const { container } = render(<CountBadge count={3} />);
    expect(chip(container)).toHaveTextContent('3');
  });

  it('renders nothing at zero or below', () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(chip(container)).toBeNull();
    rerender(<CountBadge count={-2} />);
    expect(chip(container)).toBeNull();
  });

  it('caps a large count at 99+', () => {
    const { container } = render(<CountBadge count={140} />);
    expect(chip(container)).toHaveTextContent('99+');
  });

  it('stays out of the accessibility tree — the control names the count', () => {
    const { container } = render(<CountBadge count={5} />);
    expect(chip(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes its placement from the caller', () => {
    const { container } = render(
      <CountBadge count={1} className="absolute -top-1 -right-1" />,
    );
    expect(chip(container)).toHaveClass('absolute', '-top-1', '-right-1');
  });
});
