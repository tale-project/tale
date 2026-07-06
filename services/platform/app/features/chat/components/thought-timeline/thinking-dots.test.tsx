import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThinkingDots } from './thinking-dots';

describe('ThinkingDots', () => {
  afterEach(() => vi.restoreAllMocks());

  it('anchors each dot animation-delay to the wall clock so a remount resumes the same phase', () => {
    // The thought header remounts mid-turn (pre-answer ThinkingIndicator →
    // in-bubble MessageThoughtHeader). A dots element seeded purely at mount
    // would restart its 1.2s bounce from phase zero — a visible hitch. Anchoring
    // the negative animation-delay to `Date.now()` makes any element mounted at
    // instant T resume at the phase a continuously-running dot is at at T, so the
    // handoff is seamless. now = 10000 → 10000 % 1200 = 400.
    const now = 10_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { container } = render(<ThinkingDots />);
    const dots = Array.from(
      container.querySelectorAll('span[style]'),
    ) as HTMLElement[];
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => d.style.animationDelay)).toEqual([
      `${-((now - 0) % 1200)}ms`, // -400ms
      `${-((now - 150) % 1200)}ms`, // -250ms
      `${-((now - 300) % 1200)}ms`, // -100ms
    ]);
  });
});
