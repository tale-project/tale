import { LoaderCircle, Play } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { pendingIcon, SPIN_CLASS } from './pending-icon';

describe('pendingIcon', () => {
  it('is the icon itself while nothing is under way', () => {
    expect(pendingIcon(false, Play)).toEqual({
      icon: Play,
      iconClassName: undefined,
    });
  });

  it('is a spinner that stops for a person who asks for less motion, while the work is under way', () => {
    const shown = pendingIcon(true, Play);
    expect(shown.icon).toBe(LoaderCircle);
    expect(shown.iconClassName).toBe(SPIN_CLASS);
    expect(SPIN_CLASS).toContain('motion-reduce:animate-none');
  });
});
