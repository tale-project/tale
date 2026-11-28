import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { ThinkingDots } from './thinking-dots';

describe('ThinkingDots', () => {
  it('is decorative: three pulsing dots hidden from assistive technology', () => {
    const { container } = render(<ThinkingDots />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root?.querySelectorAll('.animate-thinking-dot')).toHaveLength(3);
  });

  it('resumes the wall-clock phase on remount instead of restarting', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_500);
    const { container } = render(<ThinkingDots />);
    const delays = Array.from(
      container.querySelectorAll<HTMLElement>('.animate-thinking-dot'),
    ).map((dot) => dot.style.animationDelay);
    // (10500 - stagger) mod 1200, negative: 900, 750, 600ms into the cycle.
    expect(delays).toEqual(['-900ms', '-750ms', '-600ms']);
    vi.restoreAllMocks();
  });
});
