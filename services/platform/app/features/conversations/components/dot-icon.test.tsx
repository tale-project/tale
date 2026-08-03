import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { DotIcon } from './dot-icon';

describe('DotIcon', () => {
  it('centres the dot by position, so a caller-set display cannot move it', () => {
    // `cn` merges display utilities as one group: this className replaces the
    // component's own `inline-flex`, so centring must not rest on flex
    // alignment — it did once, and the dot rode at the top of its box.
    const { container } = render(<DotIcon className="hidden md:inline-flex" />);

    const wrapper = container.querySelector('span.size-4');
    expect(wrapper).toHaveClass('relative');
    const dot = wrapper?.firstElementChild;
    expect(dot).toHaveClass(
      'absolute',
      'top-1/2',
      'left-1/2',
      '-translate-x-1/2',
      '-translate-y-1/2',
    );
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DotIcon />);
      await checkAccessibility(container);
    });

    it('passes axe audit with custom className', async () => {
      const { container } = render(<DotIcon className="text-red-500" />);
      await checkAccessibility(container);
    });
  });
});
